import { Command } from 'commander';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getDefaultWallet, resolveWallet, getAllWallets } from '../core/wallet.ts';
import { getConnection, normalizeError } from '../core/rpc.ts';
import {
  output, heading, table, success, error, info, isJsonMode,
  formatSolShort, formatAddress, formatTokenAmount,
} from '../utils/format.ts';
import { lamportsToSol } from '../utils/amount.ts';

export const balanceCommand = new Command('balance')
  .alias('bal')
  .description('View wallet balances (SOL + SPL tokens)')
  .argument('[wallet]', 'Wallet label or pubkey (uses default if omitted)')
  .option('-a, --all', 'Show balances for all wallets')
  .option('--tokens', 'Include SPL token balances')
  .action(async (walletArg: string | undefined, opts) => {
    const conn = getConnection();

    if (opts.all) {
      const wallets = getAllWallets();
      if (wallets.length === 0) {
        output(isJsonMode() ? [] : '  No wallets. Run: solblade create');
        return;
      }

      const results: { label: string; pubkey: string; sol: number; lamports: number }[] = [];
      let totalLamports = 0;

      // Batch fetch: use getMultipleAccountsInfo for efficiency
      const pubkeys = wallets.map(w => new PublicKey(w.pubkey));
      const batchSize = 100;

      for (let i = 0; i < pubkeys.length; i += batchSize) {
        const batch = pubkeys.slice(i, i + batchSize);
        try {
          const accounts = await conn.getMultipleAccountsInfo(batch);
          for (let j = 0; j < accounts.length; j++) {
            const wallet = wallets[i + j]!;
            const lamports = accounts[j]?.lamports ?? 0;
            totalLamports += lamports;
            results.push({
              label: wallet.label,
              pubkey: wallet.pubkey,
              sol: lamportsToSol(BigInt(lamports)),
              lamports,
            });
          }
        } catch (err) {
          const normalized = normalizeError(err);
          error(`RPC error: ${normalized.message}`);
          return;
        }
      }

      if (isJsonMode()) {
        output({
          wallets: results,
          total: { sol: lamportsToSol(BigInt(totalLamports)), lamports: totalLamports },
        });
        return;
      }

      heading('All Wallet Balances');
      table(results.map(r => ({
        'Label': r.label,
        'Address': formatAddress(r.pubkey),
        'Balance': formatSolShort(r.lamports),
      })));
      console.log('');
      info(`Total: ${formatSolShort(totalLamports)}`);
      return;
    }

    // Single wallet
    const wallet = walletArg
      ? resolveWallet(walletArg)
      : getDefaultWallet();

    if (!wallet) {
      error(walletArg
        ? `Wallet not found: ${walletArg}`
        : 'No default wallet set. Run: solblade create');
      process.exit(1);
    }

    const pubkey = new PublicKey(wallet.pubkey);

    try {
      const lamports = await conn.getBalance(pubkey);
      const sol = lamportsToSol(BigInt(lamports));

      const result: Record<string, unknown> = {
        label: wallet.label,
        pubkey: wallet.pubkey,
        sol,
        lamports,
      };

      // Fetch SPL tokens if requested
      if (opts.tokens) {
        const tokenAccounts = await conn.getParsedTokenAccountsByOwner(pubkey, {
          programId: TOKEN_PROGRAM_ID,
        });

        const tokens = tokenAccounts.value
          .map(ta => {
            const info = ta.account.data.parsed?.info;
            if (!info) return null;
            return {
              mint: info.mint as string,
              amount: info.tokenAmount.amount as string,
              decimals: info.tokenAmount.decimals as number,
              uiAmount: info.tokenAmount.uiAmount as number,
            };
          })
          .filter((t): t is NonNullable<typeof t> => t !== null && Number(t.amount) > 0);

        result.tokens = tokens;
        result.tokenAccountCount = tokenAccounts.value.length;
        result.emptyAccounts = tokenAccounts.value.length - tokens.length;

        if (!isJsonMode()) {
          heading(`${wallet.label} (${formatAddress(wallet.pubkey)})`);
          info(`SOL: ${formatSolShort(lamports)}`);
          console.log('');

          if (tokens.length > 0) {
            heading('SPL Tokens');
            table(tokens.map(t => ({
              'Mint': formatAddress(t.mint),
              'Balance': t.uiAmount.toString(),
              'Decimals': t.decimals.toString(),
            })));
          }

          const emptyAccounts = tokenAccounts.value.filter(ta => {
            const amt = BigInt(ta.account.data.parsed?.info?.tokenAmount?.amount ?? '0');
            return amt === 0n;
          });
          if (emptyAccounts.length > 0) {
            const reclaimableLamports = emptyAccounts.reduce((sum, ta) => sum + ta.account.lamports, 0);
            info(`${emptyAccounts.length} empty token accounts (${formatSolShort(reclaimableLamports)} reclaimable)`);
          }
        }
      } else if (!isJsonMode()) {
        heading(`${wallet.label} (${formatAddress(wallet.pubkey)})`);
        info(`SOL: ${formatSolShort(lamports)}`);
        info('Use --tokens to show SPL token balances');
      }

      if (isJsonMode()) {
        output(result);
      }
    } catch (err) {
      const normalized = normalizeError(err);
      error(`RPC error: ${normalized.message}`);
      process.exit(1);
    }
  });

export const portfolioCommand = new Command('portfolio')
  .description('Aggregate portfolio view across all wallets')
  .action(async () => {
    const conn = getConnection();
    const wallets = getAllWallets();

    if (wallets.length === 0) {
      output(isJsonMode() ? { wallets: [], total: 0 } : '  No wallets. Run: solblade create');
      return;
    }

    const pubkeys = wallets.map(w => new PublicKey(w.pubkey));
    const results: { label: string; pubkey: string; sol: number; tokenAccounts: number }[] = [];
    let totalSol = 0;
    let totalTokenAccounts = 0;

    // Fetch SOL balances in batches
    for (let i = 0; i < pubkeys.length; i += 100) {
      const batch = pubkeys.slice(i, i + 100);
      const accounts = await conn.getMultipleAccountsInfo(batch);
      for (let j = 0; j < accounts.length; j++) {
        const lamports = accounts[j]?.lamports ?? 0;
        const sol = lamportsToSol(BigInt(lamports));
        totalSol += sol;
        results.push({
          label: wallets[i + j]!.label,
          pubkey: wallets[i + j]!.pubkey,
          sol,
          tokenAccounts: 0,
        });
      }
    }

    if (isJsonMode()) {
      output({ wallets: results, totalSol });
      return;
    }

    heading('Portfolio');
    table(results.map(r => ({
      'Label': r.label,
      'Address': formatAddress(r.pubkey),
      'SOL': r.sol.toFixed(4),
    })));
    console.log('');
    info(`Total: ${totalSol.toFixed(4)} SOL`);
    info(`Wallets: ${results.length}`);
  });
