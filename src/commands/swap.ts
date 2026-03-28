import { Command } from 'commander';
import { VersionedTransaction } from '@solana/web3.js';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import {
  getQuote,
  getSwapTransaction,
  resolveMint,
  formatRoute,
  getTokenPrice,
  KNOWN_MINTS,
} from '../core/jupiter.ts';
import { getDefaultWallet, resolveWallet, getKeypair } from '../core/wallet.ts';
import { requireSession } from '../core/session.ts';
import { getConnection, sendRawWithRetry, confirmTransaction, normalizeError } from '../core/rpc.ts';
import { appendEvent } from '../core/database.ts';
import { loadConfig } from '../utils/config.ts';
import { solToLamports } from '../utils/amount.ts';
import {
  output, success, error, info, heading, isJsonMode, formatSolShort, formatAddress,
} from '../utils/format.ts';

export const swapCommand = new Command('swap')
  .description('Swap tokens via Jupiter')
  .argument('<amount>', 'Amount to swap')
  .argument('<input>', 'Input token (SOL, USDC, or mint address)')
  .option('--to <output>', 'Output token (required)')
  .option('--from <wallet>', 'Source wallet (default wallet if omitted)')
  .option('--slippage <bps>', 'Slippage tolerance in basis points', '50')
  .option('--quote-only', 'Show quote without executing')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (amountStr: string, inputToken: string, opts) => {
    if (!opts.to) {
      error('--to <output-token> is required. Example: solblade swap 1 SOL --to USDC');
      process.exit(1);
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      error(`Invalid amount: ${amountStr}`);
      process.exit(1);
    }

    const inputMint = resolveMint(inputToken);
    const outputMint = resolveMint(opts.to);
    const slippageBps = parseInt(opts.slippage) || 50;
    const correlationId = crypto.randomUUID();

    // Resolve wallet
    const wallet = opts.from
      ? resolveWallet(opts.from)
      : getDefaultWallet();

    if (!wallet) {
      error(opts.from ? `Wallet not found: ${opts.from}` : 'No default wallet. Run: solblade create');
      process.exit(1);
    }

    // Determine input decimals for amount conversion
    const isInputSol = inputMint === KNOWN_MINTS['SOL'];
    let inputAmountRaw: string;

    if (isInputSol) {
      inputAmountRaw = solToLamports(amount).toString();
    } else {
      // For SPL tokens, we need decimals — fetch from RPC
      const conn = getConnection();
      const mintInfo = await conn.getParsedAccountInfo(new (await import('@solana/web3.js')).PublicKey(inputMint));
      const data = mintInfo.value?.data;
      let decimals = 9;
      if (data && typeof data === 'object' && 'parsed' in data) {
        decimals = data.parsed?.info?.decimals ?? 9;
      }
      inputAmountRaw = BigInt(Math.round(amount * (10 ** decimals))).toString();
    }

    // Get quote
    const spinner = isJsonMode() ? null : p.spinner();
    spinner?.start('Fetching Jupiter quote...');

    let quote;
    try {
      quote = await getQuote(inputMint, outputMint, inputAmountRaw, slippageBps);
    } catch (err) {
      spinner?.stop('Quote failed.');
      error((err as Error).message);
      process.exit(1);
    }

    // Fetch USD prices for display
    const [inputPrice, outputPrice] = await Promise.all([
      getTokenPrice(inputMint),
      getTokenPrice(outputMint),
    ]);

    const inputUsd = inputPrice ? (amount * inputPrice).toFixed(2) : null;

    const outDecimals = isOutputSol(outputMint) ? 9 : await getDecimals(outputMint).catch(() => 9);
    const outputAmount = Number(quote.outAmount) / (10 ** outDecimals);
    const outputUsd = outputPrice ? (outputAmount * outputPrice).toFixed(2) : null;

    const route = formatRoute(quote);
    const priceImpact = parseFloat(quote.priceImpactPct);

    spinner?.stop('Quote received.');

    // Display quote
    if (isJsonMode()) {
      const quoteData = {
        input: { token: inputToken.toUpperCase(), amount, mint: inputMint, usd: inputUsd },
        output: { token: opts.to.toUpperCase(), amount: outputAmount, mint: outputMint, usd: outputUsd },
        route: route,
        priceImpact: `${priceImpact.toFixed(4)}%`,
        slippage: `${slippageBps}bps`,
        wallet: wallet.label,
      };

      if (opts.quoteOnly) {
        output(quoteData);
        return;
      }
      // Continue to execute below
    } else {
      heading('Swap Quote');
      console.log(`  ${chalk.white.bold(amount)} ${chalk.cyan(inputToken.toUpperCase())}${inputUsd ? chalk.dim(` ($${inputUsd})`) : ''}`);
      console.log(chalk.gray('  ↓'));
      console.log(`  ${chalk.white.bold(outputAmount.toFixed(6))} ${chalk.cyan(opts.to.toUpperCase())}${outputUsd ? chalk.dim(` ($${outputUsd})`) : ''}`);
      console.log('');
      info(`Route: ${route.join(' → ')}`);
      info(`Price impact: ${priceImpact < 0.01 ? chalk.green(`${priceImpact.toFixed(4)}%`) : priceImpact < 1 ? chalk.yellow(`${priceImpact.toFixed(4)}%`) : chalk.red(`${priceImpact.toFixed(4)}%`)}`);
      info(`Slippage: ${slippageBps}bps`);
      info(`Wallet: ${wallet.label}`);

      if (opts.quoteOnly) return;
    }

    // Confirm
    if (!opts.yes && !isJsonMode()) {
      const confirmed = await p.confirm({ message: 'Execute this swap?' });
      if (p.isCancel(confirmed) || !confirmed) {
        info('Cancelled.');
        return;
      }
    }

    // Execute swap
    const derivedKey = await requireSession();

    appendEvent({
      timestamp: new Date().toISOString(),
      eventType: 'swap.requested',
      walletId: wallet.id,
      actor: 'user',
      correlationId,
      payload: {
        input: inputToken, output: opts.to, amount,
        inputMint, outputMint, slippageBps,
      },
      signature: null,
    });

    spinner?.start('Building swap transaction...');

    try {
      const swapResult = await getSwapTransaction(quote, wallet.pubkey);
      spinner?.stop('Transaction built.');

      // Deserialize and sign
      const txBuf = Buffer.from(swapResult.swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);
      const keypair = await getKeypair(wallet.label, derivedKey);
      tx.sign([keypair]);

      // Send
      spinner?.start('Sending transaction...');
      const signature = await sendRawWithRetry(Buffer.from(tx.serialize()));

      spinner?.start('Confirming...');
      const config = loadConfig();
      const status = await confirmTransaction(signature, config.confirmationLevel);
      spinner?.stop('Swap confirmed.');

      appendEvent({
        timestamp: new Date().toISOString(),
        eventType: 'swap.confirmed',
        walletId: wallet.id,
        actor: 'user',
        correlationId,
        payload: { signature, slot: status.slot, outputAmount },
        signature,
      });

      if (isJsonMode()) {
        output({
          signature,
          status: 'confirmed',
          slot: status.slot,
          input: { token: inputToken.toUpperCase(), amount, mint: inputMint },
          output: { token: opts.to.toUpperCase(), amount: outputAmount, mint: outputMint },
          explorer: `https://solscan.io/tx/${signature}`,
        });
      } else {
        success(`Swapped ${amount} ${inputToken.toUpperCase()} → ${outputAmount.toFixed(6)} ${opts.to.toUpperCase()}`);
        output(`  Signature: ${signature}`);
        output(`  Explorer: https://solscan.io/tx/${signature}`);
      }
    } catch (err) {
      spinner?.stop('Swap failed.');
      const normalized = normalizeError(err);
      error(`Swap failed: ${normalized.message}`);
      process.exit(1);
    }
  });

function isOutputSol(mint: string): boolean {
  return mint === KNOWN_MINTS['SOL'];
}

async function getDecimals(mint: string): Promise<number> {
  // Check known tokens first
  const knownDecimals: Record<string, number> = {
    [KNOWN_MINTS['USDC']!]: 6,
    [KNOWN_MINTS['USDT']!]: 6,
    [KNOWN_MINTS['SOL']!]: 9,
    [KNOWN_MINTS['BONK']!]: 5,
    [KNOWN_MINTS['JUP']!]: 6,
    [KNOWN_MINTS['WIF']!]: 6,
    [KNOWN_MINTS['PYTH']!]: 6,
  };

  if (knownDecimals[mint] !== undefined) return knownDecimals[mint]!;

  // Fetch from RPC
  const conn = getConnection();
  const { PublicKey } = await import('@solana/web3.js');
  const info = await conn.getParsedAccountInfo(new PublicKey(mint));
  const data = info.value?.data;
  if (data && typeof data === 'object' && 'parsed' in data) {
    return data.parsed?.info?.decimals ?? 9;
  }
  return 9;
}
