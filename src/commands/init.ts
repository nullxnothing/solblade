import { Command } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { getAllWallets } from '../core/database.ts';
import { unlockSession, getSessionInfo } from '../core/session.ts';
import { createWallet } from '../core/wallet.ts';
import { loadConfig, updateConfig } from '../utils/config.ts';
import { output, isJsonMode } from '../utils/format.ts';

const BANNER = chalk.cyan(`
   ███████╗ ██████╗ ██╗     ██████╗ ██╗      █████╗ ██████╗ ███████╗
   ██╔════╝██╔═══██╗██║     ██╔══██╗██║     ██╔══██╗██╔══██╗██╔════╝
   ███████╗██║   ██║██║     ██████╔╝██║     ███████║██║  ██║█████╗
   ╚════██║██║   ██║██║     ██╔══██╗██║     ██╔══██║██║  ██║██╔══╝
   ███████║╚██████╔╝███████╗██████╔╝███████╗██║  ██║██████╔╝███████╗
   ╚══════╝ ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝
`) + chalk.gray('                     v0.1.0  ·  Sharp. Fast. AI-Native.');

const RPC_PROVIDERS: Record<string, string> = {
  helius: 'https://mainnet.helius-rpc.com/?api-key=',
  quicknode: 'https://your-endpoint.quiknode.pro/',
  triton: 'https://your-project.rpcpool.com/',
  solana: 'https://api.mainnet-beta.solana.com',
};

export const initCommand = new Command('init')
  .description('Set up Solblade for the first time')
  .option('--rpc <url>', 'RPC endpoint URL')
  .option('--label <label>', 'Label for your first wallet')
  .option('--skip-wallet', 'Skip wallet creation')
  .action(async (opts) => {
    if (isJsonMode()) return runJsonInit(opts);

    console.log(BANNER);
    console.log('');

    // Check if already set up
    const wallets = getAllWallets();
    if (wallets.length > 0) {
      p.log.warn(`Solblade is already initialized with ${wallets.length} wallet(s).`);
      p.log.info('Run: solblade list');
      return;
    }

    p.intro(chalk.cyan.bold(' Welcome to Solblade '));

    // --- Step 1: RPC ---
    let rpcUrl = opts.rpc;
    if (!rpcUrl) {
      const provider = await p.select({
        message: 'Select your RPC provider',
        options: [
          { value: 'helius', label: 'Helius', hint: 'recommended — fast, free tier available' },
          { value: 'quicknode', label: 'QuickNode', hint: 'reliable, paid' },
          { value: 'triton', label: 'Triton (RPCPool)', hint: 'enterprise grade' },
          { value: 'solana', label: 'Solana Public', hint: 'free, rate-limited' },
          { value: 'custom', label: 'Custom URL', hint: 'paste your own endpoint' },
        ],
      });

      if (p.isCancel(provider)) { p.cancel('Setup cancelled.'); process.exit(0); }

      if (provider === 'custom') {
        const url = await p.text({
          message: 'Enter your RPC endpoint URL',
          placeholder: 'https://your-rpc-endpoint.com',
          validate: (v) => {
            if (!v.startsWith('http')) return 'Must be a valid URL starting with http:// or https://';
          },
        });
        if (p.isCancel(url)) { p.cancel('Setup cancelled.'); process.exit(0); }
        rpcUrl = url;
      } else if (provider === 'solana') {
        rpcUrl = RPC_PROVIDERS.solana!;
      } else {
        const apiKey = await p.text({
          message: `Enter your ${provider === 'helius' ? 'Helius' : provider === 'quicknode' ? 'QuickNode' : 'Triton'} API key`,
          placeholder: 'your-api-key-here',
          validate: (v) => {
            if (!v.trim()) return 'API key is required';
          },
        });
        if (p.isCancel(apiKey)) { p.cancel('Setup cancelled.'); process.exit(0); }

        if (provider === 'helius') {
          rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
        } else if (provider === 'quicknode') {
          const endpoint = await p.text({
            message: 'Enter your QuickNode endpoint URL',
            placeholder: 'https://your-endpoint.quiknode.pro/your-key',
          });
          if (p.isCancel(endpoint)) { p.cancel('Setup cancelled.'); process.exit(0); }
          rpcUrl = endpoint;
        } else {
          const endpoint = await p.text({
            message: 'Enter your Triton endpoint URL',
            placeholder: 'https://your-project.rpcpool.com/your-key',
          });
          if (p.isCancel(endpoint)) { p.cancel('Setup cancelled.'); process.exit(0); }
          rpcUrl = endpoint;
        }
      }
    }

    updateConfig({ rpcEndpoints: [rpcUrl.trim()] });
    p.log.success(`RPC: ${maskUrl(rpcUrl.trim())}`);

    // --- Step 2: Password ---
    const password = await p.password({
      message: 'Create a keystore password',
      validate: (v) => {
        if (v.length < 6) return 'Password must be at least 6 characters';
      },
    });
    if (p.isCancel(password)) { p.cancel('Setup cancelled.'); process.exit(0); }

    const confirmPass = await p.password({
      message: 'Confirm your password',
    });
    if (p.isCancel(confirmPass)) { p.cancel('Setup cancelled.'); process.exit(0); }

    if (password !== confirmPass) {
      p.cancel('Passwords do not match.');
      process.exit(1);
    }

    const s = p.spinner();
    s.start('Deriving encryption key...');
    const derivedKey = await unlockSession(password);
    s.stop('Keystore encrypted and session unlocked.');

    // --- Step 3: First Wallet ---
    let walletResult: { pubkey: string; label: string } | null = null;

    if (!opts.skipWallet) {
      const walletAction = await p.select({
        message: 'Set up your first wallet',
        options: [
          { value: 'create', label: 'Create new wallet', hint: 'generate a fresh keypair' },
          { value: 'import-key', label: 'Import private key', hint: 'paste a base58 private key' },
          { value: 'import-phrase', label: 'Import seed phrase', hint: '12 or 24 word recovery phrase' },
          { value: 'skip', label: 'Skip for now' },
        ],
      });

      if (p.isCancel(walletAction)) { p.cancel('Setup cancelled.'); process.exit(0); }

      if (walletAction !== 'skip') {
        const label = await p.text({
          message: 'Label this wallet',
          placeholder: 'main',
          defaultValue: opts.label ?? 'main',
        });
        if (p.isCancel(label)) { p.cancel('Setup cancelled.'); process.exit(0); }

        const walletLabel = (label as string).trim() || 'main';

        if (walletAction === 'create') {
          s.start('Generating keypair...');
          walletResult = await createWallet(derivedKey, { label: walletLabel });
          s.stop(`Wallet created: ${chalk.bold(walletLabel)}`);
        } else if (walletAction === 'import-key') {
          const key = await p.password({
            message: 'Paste your base58 private key',
            validate: (v) => {
              if (v.length < 32) return 'Invalid private key';
            },
          });
          if (p.isCancel(key)) { p.cancel('Setup cancelled.'); process.exit(0); }

          s.start('Importing wallet...');
          const { importWallet } = await import('../core/wallet.ts');
          walletResult = await importWallet(derivedKey, { privateKey: key, label: walletLabel });
          s.stop(`Wallet imported: ${chalk.bold(walletLabel)}`);
        } else if (walletAction === 'import-phrase') {
          const phrase = await p.password({
            message: 'Enter your seed phrase (12 or 24 words)',
            validate: (v) => {
              const words = v.trim().split(/\s+/);
              if (words.length !== 12 && words.length !== 24) return 'Must be 12 or 24 words';
            },
          });
          if (p.isCancel(phrase)) { p.cancel('Setup cancelled.'); process.exit(0); }

          s.start('Importing wallet...');
          const { importWallet } = await import('../core/wallet.ts');
          walletResult = await importWallet(derivedKey, { seedPhrase: phrase, label: walletLabel });
          s.stop(`Wallet imported: ${chalk.bold(walletLabel)}`);
        }
      }
    }

    // --- Done ---
    const sessionInfo = getSessionInfo();

    p.note(
      [
        walletResult ? `${chalk.bold('Wallet')}   ${walletResult.label} (${walletResult.pubkey.slice(0, 8)}...${walletResult.pubkey.slice(-4)})` : null,
        `${chalk.bold('RPC')}      ${maskUrl(rpcUrl.trim())}`,
        `${chalk.bold('Session')}  ${sessionInfo.remainingMinutes} min remaining`,
        '',
        `${chalk.gray('solblade balance')}          ${chalk.dim('check your balance')}`,
        `${chalk.gray('solblade create -l bot1')}    ${chalk.dim('create more wallets')}`,
        `${chalk.gray('solblade list')}              ${chalk.dim('see all wallets')}`,
        `${chalk.gray('solblade send 1 SOL --to')}   ${chalk.dim('send SOL')}`,
        `${chalk.gray('solblade cleanup scan')}      ${chalk.dim('find reclaimable rent')}`,
      ].filter(Boolean).join('\n'),
      'Quick start'
    );

    p.outro(chalk.green.bold('Setup complete. You\'re ready to go.'));
  });

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has('api-key')) {
      const key = u.searchParams.get('api-key')!;
      u.searchParams.set('api-key', key.slice(0, 4) + '...' + key.slice(-4));
    }
    return u.toString();
  } catch {
    return url.length > 50 ? url.slice(0, 47) + '...' : url;
  }
}

async function runJsonInit(opts: { rpc?: string; label?: string; skipWallet?: boolean }) {
  const wallets = getAllWallets();
  if (wallets.length > 0) {
    output({ status: 'already_initialized', walletCount: wallets.length });
    return;
  }

  if (opts.rpc) {
    updateConfig({ rpcEndpoints: [opts.rpc] });
  }

  const password = process.env.SOLBLADE_PASSWORD;
  if (!password) {
    output({ error: 'Set SOLBLADE_PASSWORD env var for non-interactive init' });
    process.exit(1);
  }

  const derivedKey = await unlockSession(password);
  let wallet = null;

  if (!opts.skipWallet) {
    const label = opts.label ?? 'main';
    const result = await createWallet(derivedKey, { label });
    wallet = result;
  }

  output({
    status: 'initialized',
    rpc: opts.rpc ?? loadConfig().rpcEndpoints[0],
    wallet,
  });
}
