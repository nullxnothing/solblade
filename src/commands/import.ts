import { Command } from 'commander';
import { importWallet } from '../core/wallet.ts';
import { requireSession } from '../core/session.ts';
import { output, success, error, isJsonMode } from '../utils/format.ts';

export const importCommand = new Command('import')
  .description('Import a wallet from seed phrase or private key')
  .option('-l, --label <label>', 'Wallet label')
  .option('-g, --group <group>', 'Wallet group')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-k, --key <key>', 'Base58 private key')
  .option('-p, --phrase <phrase>', 'BIP39 seed phrase (12 or 24 words)')
  .option('--path <path>', 'Derivation path (default: Phantom m/44\'/501\'/0\'/0\')')
  .action(async (opts) => {
    if (!opts.key && !opts.phrase) {
      error('Must provide --key or --phrase');
      process.exit(1);
    }

    // Warn if key passed as CLI arg (visible in history)
    if (opts.key) {
      // Still allow it but note: stdin is safer
      // TODO: Phase 2 — add stdin pipe import
    }

    const derivedKey = await requireSession();

    try {
      const tags = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined;
      const { pubkey, label } = await importWallet(derivedKey, {
        privateKey: opts.key,
        seedPhrase: opts.phrase,
        derivationPath: opts.path,
        label: opts.label,
        groupName: opts.group,
        tags,
      });

      if (isJsonMode()) {
        output({ pubkey, label, status: 'imported' });
      } else {
        success(`Wallet imported: ${label}`);
        output(`  Address: ${pubkey}`);
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
