import { Command } from 'commander';
import { labelWallet, resolveWallet } from '../core/wallet.ts';
import { updateWalletGroup, updateWalletTags } from '../core/database.ts';
import { output, success, error, isJsonMode } from '../utils/format.ts';

export const labelCommand = new Command('label')
  .description('Rename a wallet')
  .argument('<wallet>', 'Wallet label or pubkey')
  .argument('<new-label>', 'New label')
  .action(async (wallet: string, newLabel: string) => {
    try {
      await labelWallet(wallet, newLabel);
      if (isJsonMode()) {
        output({ wallet, newLabel, status: 'renamed' });
      } else {
        success(`Renamed "${wallet}" -> "${newLabel}"`);
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

export const groupCommand = new Command('group')
  .description('Set wallet group')
  .argument('<wallet>', 'Wallet label or pubkey')
  .argument('[group]', 'Group name (omit to clear)')
  .action(async (wallet: string, group?: string) => {
    const w = resolveWallet(wallet);
    if (!w) { error(`Wallet not found: ${wallet}`); process.exit(1); }
    updateWalletGroup(w.id, group ?? null);
    if (isJsonMode()) {
      output({ wallet: w.label, group: group ?? null });
    } else {
      success(group ? `Set group "${group}" on ${w.label}` : `Cleared group on ${w.label}`);
    }
  });

export const tagCommand = new Command('tag')
  .description('Set wallet tags')
  .argument('<wallet>', 'Wallet label or pubkey')
  .argument('<tags>', 'Comma-separated tags')
  .action(async (wallet: string, tags: string) => {
    const w = resolveWallet(wallet);
    if (!w) { error(`Wallet not found: ${wallet}`); process.exit(1); }
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    updateWalletTags(w.id, tagList);
    if (isJsonMode()) {
      output({ wallet: w.label, tags: tagList });
    } else {
      success(`Tags set on ${w.label}: ${tagList.join(', ')}`);
    }
  });
