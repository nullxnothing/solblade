import { Command } from 'commander';
import { listWallets } from '../core/wallet.ts';
import { output, table, heading, isJsonMode, formatAddress } from '../utils/format.ts';

export const listCommand = new Command('list')
  .alias('ls')
  .description('List all wallets')
  .option('-g, --group <group>', 'Filter by group')
  .option('-a, --all', 'Include archived wallets')
  .action((opts) => {
    const wallets = listWallets(opts.group);

    if (wallets.length === 0) {
      output(isJsonMode() ? [] : '  No wallets found. Run: solblade create');
      return;
    }

    if (isJsonMode()) {
      output(wallets.map(w => ({
        label: w.label,
        pubkey: w.pubkey,
        group: w.group_name,
        tags: JSON.parse(w.tags),
        isDefault: w.is_default === 1,
        aiAccess: w.ai_access,
        createdAt: w.created_at,
      })));
      return;
    }

    heading('Wallets');
    table(wallets.map(w => ({
      '': w.is_default ? '*' : ' ',
      'Label': w.label,
      'Address': formatAddress(w.pubkey),
      'Group': w.group_name ?? '-',
      'Tags': JSON.parse(w.tags).join(', ') || '-',
      'AI': w.ai_access,
    })));
  });
