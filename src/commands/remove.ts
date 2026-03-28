import { Command } from 'commander';
import { removeWallet } from '../core/wallet.ts';
import { output, success, error, warn, isJsonMode } from '../utils/format.ts';

export const removeCommand = new Command('remove')
  .alias('rm')
  .description('Archive or permanently delete a wallet')
  .argument('<wallet>', 'Wallet label or pubkey')
  .option('--hard', 'Permanently delete (cannot be recovered)')
  .action(async (wallet: string, opts) => {
    if (opts.hard) {
      warn('This will permanently delete the wallet and its encrypted key file.');
      // In a full impl, prompt for confirmation
    }

    try {
      await removeWallet(wallet, opts.hard);
      if (isJsonMode()) {
        output({ wallet, status: opts.hard ? 'deleted' : 'archived' });
      } else {
        success(opts.hard
          ? `Wallet "${wallet}" permanently deleted.`
          : `Wallet "${wallet}" archived. Use --hard to permanently delete.`
        );
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
