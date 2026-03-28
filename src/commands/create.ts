import { Command } from 'commander';
import { createWallet } from '../core/wallet.ts';
import { requireSession } from '../core/session.ts';
import { output, success, isJsonMode } from '../utils/format.ts';

export const createCommand = new Command('create')
  .description('Generate a new Solana wallet')
  .option('-l, --label <label>', 'Wallet label')
  .option('-g, --group <group>', 'Wallet group')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action(async (opts) => {
    const derivedKey = await requireSession();

    const tags = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined;
    const { pubkey, label } = await createWallet(derivedKey, {
      label: opts.label,
      groupName: opts.group,
      tags,
    });

    if (isJsonMode()) {
      output({ pubkey, label, status: 'created' });
    } else {
      success(`Wallet created: ${label}`);
      output(`  Address: ${pubkey}`);
    }
  });
