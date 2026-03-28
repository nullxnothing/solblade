import { Command } from 'commander';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createCloseAccountInstruction } from '@solana/spl-token';
import { Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { getDefaultWallet, resolveWallet, getKeypair } from '../core/wallet.ts';
import { requireSession } from '../core/session.ts';
import { getConnection, sendRawWithRetry, confirmTransaction, normalizeError } from '../core/rpc.ts';
import { loadConfig } from '../utils/config.ts';
import {
  output, heading, table, success, error, info, isJsonMode,
  formatAddress, formatSolShort,
} from '../utils/format.ts';

export const cleanupCommand = new Command('cleanup')
  .description('Token account cleanup and rent recovery');

cleanupCommand
  .command('scan')
  .description('Scan for empty token accounts and reclaimable rent')
  .argument('[wallet]', 'Wallet label or pubkey')
  .action(async (walletArg?: string) => {
    const wallet = walletArg ? resolveWallet(walletArg) : getDefaultWallet();
    if (!wallet) {
      error(walletArg ? `Wallet not found: ${walletArg}` : 'No default wallet set.');
      process.exit(1);
    }

    const conn = getConnection();
    const pubkey = new PublicKey(wallet.pubkey);

    const tokenAccounts = await conn.getParsedTokenAccountsByOwner(pubkey, {
      programId: TOKEN_PROGRAM_ID,
    });

    const empty: { address: string; mint: string; rentLamports: number }[] = [];

    for (const ta of tokenAccounts.value) {
      const parsed = ta.account.data.parsed?.info;
      if (!parsed) continue;
      const amount = BigInt(parsed.tokenAmount?.amount ?? '0');
      if (amount === 0n) {
        empty.push({
          address: ta.pubkey.toBase58(),
          mint: parsed.mint,
          rentLamports: ta.account.lamports,
        });
      }
    }

    const totalReclaimable = empty.reduce((sum, e) => sum + e.rentLamports, 0);

    if (isJsonMode()) {
      output({
        wallet: wallet.label,
        totalAccounts: tokenAccounts.value.length,
        emptyAccounts: empty.length,
        reclaimableLamports: totalReclaimable,
        reclaimableSol: totalReclaimable / 1e9,
        accounts: empty,
      });
      return;
    }

    heading(`Cleanup Scan: ${wallet.label}`);
    info(`Total token accounts: ${tokenAccounts.value.length}`);
    info(`Empty accounts: ${empty.length}`);
    info(`Reclaimable: ${formatSolShort(totalReclaimable)}`);

    if (empty.length > 0) {
      console.log('');
      table(empty.slice(0, 20).map(e => ({
        'Token Account': formatAddress(e.address),
        'Mint': formatAddress(e.mint),
        'Rent': formatSolShort(e.rentLamports),
      })));
      if (empty.length > 20) {
        info(`... and ${empty.length - 20} more`);
      }
      console.log('');
      info('Run: solblade cleanup burn --all');
    }
  });

cleanupCommand
  .command('burn')
  .description('Close empty token accounts and reclaim rent')
  .argument('[wallet]', 'Wallet label or pubkey')
  .option('--all', 'Close all empty token accounts')
  .option('--mint <mint>', 'Close only accounts for this mint')
  .action(async (walletArg: string | undefined, opts) => {
    const derivedKey = await requireSession();
    const wallet = walletArg ? resolveWallet(walletArg) : getDefaultWallet();
    if (!wallet) {
      error(walletArg ? `Wallet not found: ${walletArg}` : 'No default wallet set.');
      process.exit(1);
    }

    const conn = getConnection();
    const config = loadConfig();
    const pubkey = new PublicKey(wallet.pubkey);

    // Fetch empty accounts
    const tokenAccounts = await conn.getParsedTokenAccountsByOwner(pubkey, {
      programId: TOKEN_PROGRAM_ID,
    });

    let empty = tokenAccounts.value.filter(ta => {
      const amount = BigInt(ta.account.data.parsed?.info?.tokenAmount?.amount ?? '0');
      return amount === 0n;
    });

    if (opts.mint) {
      empty = empty.filter(ta => ta.account.data.parsed?.info?.mint === opts.mint);
    }

    if (empty.length === 0) {
      if (isJsonMode()) {
        output({ closed: 0, reclaimedLamports: 0 });
      } else {
        info('No empty token accounts to close.');
      }
      return;
    }

    const keypair = await getKeypair(wallet.label, derivedKey);

    // Batch close: max ~20 close instructions per tx
    const BATCH_SIZE = 20;
    let totalClosed = 0;
    let totalReclaimed = 0;
    const signatures: string[] = [];

    for (let i = 0; i < empty.length; i += BATCH_SIZE) {
      const batch = empty.slice(i, i + BATCH_SIZE);

      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const tx = new Transaction({ feePayer: pubkey, blockhash, lastValidBlockHeight });

      tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 * batch.length }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: Math.round(config.defaultPriorityFee * 1e9 * 1e6 / (50_000 * batch.length)),
        }),
      );

      const batchLamports = batch.reduce((sum, ta) => sum + ta.account.lamports, 0);

      for (const ta of batch) {
        tx.add(
          createCloseAccountInstruction(
            ta.pubkey,       // account to close
            pubkey,          // rent destination
            pubkey,          // authority
          )
        );
      }

      tx.sign(keypair);

      try {
        const sig = await sendRawWithRetry(Buffer.from(tx.serialize()));
        await confirmTransaction(sig, config.confirmationLevel);
        signatures.push(sig);
        totalClosed += batch.length;
        totalReclaimed += batchLamports;

        if (!isJsonMode()) {
          info(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: closed ${batch.length} accounts`);
        }
      } catch (err) {
        const normalized = normalizeError(err);
        error(`Batch failed: ${normalized.message}`);
      }
    }

    if (isJsonMode()) {
      output({
        closed: totalClosed,
        reclaimedLamports: totalReclaimed,
        reclaimedSol: totalReclaimed / 1e9,
        signatures,
      });
    } else {
      success(`Closed ${totalClosed} empty accounts`);
      info(`Reclaimed: ${formatSolShort(totalReclaimed)}`);
      for (const sig of signatures) {
        output(`  https://solscan.io/tx/${sig}`);
      }
    }
  });
