import { Command } from 'commander';
import { setDefault, getDefaultWallet } from '../core/wallet.ts';
import { output, success, error, info, isJsonMode, formatAddress } from '../utils/format.ts';

export const defaultCommand = new Command('default')
  .description('Set or show the default wallet')
  .argument('[wallet]', 'Wallet label or pubkey to set as default')
  .action(async (wallet?: string) => {
    if (!wallet) {
      const current = getDefaultWallet();
      if (!current) {
        if (isJsonMode()) {
          output({ default: null });
        } else {
          info('No default wallet set. Run: solblade default <wallet>');
        }
        return;
      }
      if (isJsonMode()) {
        output({ label: current.label, pubkey: current.pubkey });
      } else {
        output(`  Default: ${current.label} (${formatAddress(current.pubkey)})`);
      }
      return;
    }

    try {
      await setDefault(wallet);
      if (isJsonMode()) {
        output({ default: wallet, status: 'set' });
      } else {
        success(`Default wallet set to: ${wallet}`);
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
