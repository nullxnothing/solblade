import { Command } from 'commander';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { getDefaultWallet, resolveWallet, getKeypair } from '../core/wallet.ts';
import { requireSession } from '../core/session.ts';
import { getConnection, sendRawWithRetry, confirmTransaction, normalizeError } from '../core/rpc.ts';
import { appendEvent } from '../core/database.ts';
import { loadConfig } from '../utils/config.ts';
import { solToLamports, tokenToSmallest } from '../utils/amount.ts';
import {
  output, success, error, warn, info, isJsonMode, formatSolShort,
} from '../utils/format.ts';

export const sendCommand = new Command('send')
  .description('Send SOL or SPL tokens')
  .argument('<amount>', 'Amount to send')
  .argument('<token>', 'Token (SOL or mint address)')
  .option('--to <address>', 'Destination address (required)')
  .option('--from <wallet>', 'Source wallet (label or pubkey, default wallet if omitted)')
  .option('--priority-fee <fee>', 'Priority fee in SOL (auto if omitted)')
  .option('--skip-simulation', 'Skip transaction simulation')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (amountStr: string, token: string, opts) => {
    if (!opts.to) {
      error('--to <address> is required');
      process.exit(1);
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      error(`Invalid amount: ${amountStr}`);
      process.exit(1);
    }

    // Validate destination
    let destination: PublicKey;
    try {
      destination = new PublicKey(opts.to);
    } catch {
      error(`Invalid destination address: ${opts.to}`);
      process.exit(1);
    }

    const derivedKey = await requireSession();
    const config = loadConfig();
    const conn = getConnection();
    const correlationId = crypto.randomUUID();
    const isSol = token.toUpperCase() === 'SOL';

    // Resolve source wallet
    const wallet = opts.from
      ? resolveWallet(opts.from)
      : getDefaultWallet();

    if (!wallet) {
      error(opts.from
        ? `Wallet not found: ${opts.from}`
        : 'No default wallet set. Run: solblade create');
      process.exit(1);
    }

    // Load keypair
    let keypair;
    try {
      keypair = await getKeypair(wallet.label, derivedKey);
    } catch (err) {
      error(`Failed to load keypair: ${(err as Error).message}`);
      process.exit(1);
    }

    const sourcePubkey = keypair.publicKey;

    // Log transfer request
    appendEvent({
      timestamp: new Date().toISOString(),
      eventType: 'transfer.requested',
      walletId: wallet.id,
      actor: 'user',
      correlationId,
      payload: {
        amount, token, destination: opts.to,
        source: wallet.pubkey,
      },
      signature: null,
    });

    try {
      // Build instructions
      const instructions: TransactionInstruction[] = [];

      // Compute budget: priority fee
      const priorityFee = opts.priorityFee
        ? parseFloat(opts.priorityFee)
        : config.defaultPriorityFee;

      const cappedFee = Math.min(priorityFee, config.maxPriorityFee);
      const microLamports = Math.round(cappedFee * 1e9 * 1e6 / 200_000); // price per CU

      instructions.push(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      );

      if (isSol) {
        const lamports = solToLamports(amount);
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: sourcePubkey,
            toPubkey: destination,
            lamports,
          })
        );
      } else {
        // SPL token transfer
        const mint = new PublicKey(token);
        const decimals = await getTokenDecimals(conn, mint);

        const sourceAta = await getAssociatedTokenAddress(mint, sourcePubkey);
        const destAta = await getAssociatedTokenAddress(mint, destination);

        // Create dest ATA if needed (idempotent)
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            sourcePubkey, // payer
            destAta,
            destination,
            mint,
          )
        );

        const tokenAmount = tokenToSmallest(amount, decimals);
        instructions.push(
          createTransferInstruction(
            sourceAta,
            destAta,
            sourcePubkey,
            tokenAmount,
          )
        );
      }

      // Build transaction — fetch blockhash immediately before signing
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();

      const tx = new Transaction({
        feePayer: sourcePubkey,
        blockhash,
        lastValidBlockHeight,
      });
      tx.add(...instructions);

      // Simulate
      if (!opts.skipSimulation) {
        const simulation = await conn.simulateTransaction(tx);
        if (simulation.value.err) {
          appendEvent({
            timestamp: new Date().toISOString(),
            eventType: 'transfer.failed',
            walletId: wallet.id,
            actor: 'user',
            correlationId,
            payload: { error: simulation.value.err, logs: simulation.value.logs },
            signature: null,
          });
          error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
          if (simulation.value.logs?.length) {
            for (const log of simulation.value.logs.slice(-5)) {
              info(`  ${log}`);
            }
          }
          process.exit(1);
        }

        // Optimize compute units based on simulation
        const unitsConsumed = simulation.value.unitsConsumed ?? 200_000;
        const optimizedUnits = Math.ceil(unitsConsumed * 1.1);
        instructions[0] = ComputeBudgetProgram.setComputeUnitLimit({ units: optimizedUnits });

        // Rebuild tx with optimized CU
        const freshTx = new Transaction({
          feePayer: sourcePubkey,
          blockhash,
          lastValidBlockHeight,
        });
        freshTx.add(...instructions);

        appendEvent({
          timestamp: new Date().toISOString(),
          eventType: 'transfer.simulated',
          walletId: wallet.id,
          actor: 'user',
          correlationId,
          payload: { unitsConsumed, optimizedUnits, logs: simulation.value.logs?.slice(-3) },
          signature: null,
        });

        // Display simulation result
        if (!isJsonMode() && !opts.yes) {
          info(`Sending ${amount} ${isSol ? 'SOL' : token} -> ${opts.to}`);
          info(`Priority fee: ${cappedFee} SOL`);
          info(`Compute units: ${optimizedUnits}`);
          if (!isSol) {
            info('(includes ATA creation if needed)');
          }
        }

        // Fetch fresh blockhash right before signing
        const { blockhash: freshHash, lastValidBlockHeight: freshHeight } = await conn.getLatestBlockhash();
        freshTx.recentBlockhash = freshHash;
        freshTx.lastValidBlockHeight = freshHeight;
        freshTx.sign(keypair);

        // Send serialized
        const signature = await sendRawWithRetry(Buffer.from(freshTx.serialize()));

        appendEvent({
          timestamp: new Date().toISOString(),
          eventType: 'transfer.submitted',
          walletId: wallet.id,
          actor: 'user',
          correlationId,
          payload: { signature },
          signature,
        });

        // Confirm
        const status = await confirmTransaction(signature, config.confirmationLevel);

        appendEvent({
          timestamp: new Date().toISOString(),
          eventType: 'transfer.confirmed',
          walletId: wallet.id,
          actor: 'user',
          correlationId,
          payload: { signature, slot: status.slot },
          signature,
        });

        if (isJsonMode()) {
          output({
            signature,
            status: 'confirmed',
            slot: status.slot,
            amount,
            token: isSol ? 'SOL' : token,
            from: wallet.pubkey,
            to: opts.to,
          });
        } else {
          success(`Sent ${amount} ${isSol ? 'SOL' : token}`);
          output(`  Signature: ${signature}`);
          output(`  Explorer: https://solscan.io/tx/${signature}`);
        }
        return;
      }

      // No simulation path — fetch fresh blockhash, sign, send
      const { blockhash: bh, lastValidBlockHeight: lvbh } = await conn.getLatestBlockhash();
      tx.recentBlockhash = bh;
      tx.lastValidBlockHeight = lvbh;
      tx.sign(keypair);
      const signature = await sendRawWithRetry(Buffer.from(tx.serialize()));
      const status = await confirmTransaction(signature, config.confirmationLevel);

      if (isJsonMode()) {
        output({ signature, status: 'confirmed', slot: status.slot });
      } else {
        success(`Sent ${amount} ${isSol ? 'SOL' : token}`);
        output(`  Signature: ${signature}`);
        output(`  Explorer: https://solscan.io/tx/${signature}`);
      }
    } catch (err) {
      const normalized = normalizeError(err);
      appendEvent({
        timestamp: new Date().toISOString(),
        eventType: 'transfer.failed',
        walletId: wallet.id,
        actor: 'user',
        correlationId,
        payload: { error: normalized.message, code: normalized.code },
        signature: null,
      });
      error(`Transfer failed: ${normalized.message}`);
      process.exit(1);
    }
  });

async function getTokenDecimals(conn: ReturnType<typeof getConnection>, mint: PublicKey): Promise<number> {
  const info = await conn.getParsedAccountInfo(mint);
  const data = info.value?.data;
  if (data && typeof data === 'object' && 'parsed' in data) {
    return data.parsed?.info?.decimals ?? 9;
  }
  throw new Error(`Failed to get token decimals for ${mint.toBase58()}`);
}
