import * as p from '@clack/prompts';
import chalk from 'chalk';
import { getAllWallets, getDefaultWallet } from '../core/database.ts';
import { getSessionInfo, isSessionActive } from '../core/session.ts';
import { getConnection, normalizeError } from '../core/rpc.ts';
import { PublicKey } from '@solana/web3.js';
import { formatSolShort, formatAddress } from '../utils/format.ts';
import { loadConfig } from '../utils/config.ts';
import { lamportsToSol } from '../utils/amount.ts';

const COMPACT_BANNER = chalk.cyan(`  ╔═╗╔═╗╦  ╔╗ ╦  ╔═╗╔╦╗╔═╗
  ╚═╗║ ║║  ╠╩╗║  ╠═╣ ║║║╣
  ╚═╝╚═╝╩═╝╚═╝╩═╝╩ ╩═╩╝╚═╝`);

export async function runMenu(): Promise<void> {
  console.log('');
  console.log(COMPACT_BANNER);
  console.log(chalk.gray('  Sharp. Fast. AI-Native.'));
  console.log('');

  // Quick status bar
  const wallets = getAllWallets();
  const session = getSessionInfo();
  const defaultWallet = getDefaultWallet();

  if (wallets.length === 0) {
    p.log.warn('No wallets found. Running setup...');
    console.log('');
    const { execSync } = await import('child_process');
    execSync('bun run src/index.ts init', { stdio: 'inherit', cwd: process.cwd() });
    return;
  }

  // Fetch default wallet balance
  let balanceStr = chalk.dim('locked');
  if (defaultWallet && session.isActive) {
    try {
      const conn = getConnection();
      const lamports = await conn.getBalance(new PublicKey(defaultWallet.pubkey));
      balanceStr = chalk.white.bold(formatSolShort(lamports));
    } catch {
      balanceStr = chalk.dim('error');
    }
  }

  // Status card
  const statusLines = [
    defaultWallet
      ? `${chalk.bold('Wallet')}    ${defaultWallet.label} ${chalk.dim(`(${formatAddress(defaultWallet.pubkey)})`)}  ${balanceStr}`
      : `${chalk.bold('Wallet')}    ${chalk.dim('none set')}`,
    `${chalk.bold('Wallets')}   ${wallets.length} total`,
    `${chalk.bold('Session')}   ${session.isActive ? chalk.green(`active (${session.remainingMinutes} min)`) : chalk.red('locked')}`,
  ];
  p.note(statusLines.join('\n'), 'Status');

  // Main menu loop
  let running = true;
  while (running) {
    const action = await p.select({
      message: 'What do you want to do?',
      options: [
        { value: 'balance', label: 'View balances', hint: 'SOL + tokens for your wallets' },
        { value: 'send', label: 'Send funds', hint: 'transfer SOL or SPL tokens' },
        { value: 'wallets', label: 'Manage wallets', hint: 'create, import, label, group' },
        { value: 'cleanup', label: 'Cleanup & recover rent', hint: 'close empty accounts' },
        { value: 'swap', label: 'Swap tokens', hint: 'Jupiter-powered token swaps' },
        { value: 'config', label: 'Settings', hint: 'RPC, fees, session' },
        { value: 'log', label: 'Audit log', hint: 'view recent events' },
        { value: 'exit', label: 'Exit' },
      ],
    });

    if (p.isCancel(action) || action === 'exit') {
      p.outro(chalk.dim('Bye.'));
      running = false;
      break;
    }

    switch (action) {
      case 'balance':
        await balanceMenu();
        break;
      case 'send':
        await sendMenu();
        break;
      case 'wallets':
        await walletsMenu();
        break;
      case 'cleanup':
        await cleanupMenu();
        break;
      case 'swap':
        await swapMenu();
        break;
      case 'config':
        await configMenu();
        break;
      case 'log':
        await logMenu();
        break;
    }
  }
}

async function balanceMenu(): Promise<void> {
  const action = await p.select({
    message: 'Balance view',
    options: [
      { value: 'default', label: 'Active wallet', hint: 'SOL balance' },
      { value: 'tokens', label: 'Active wallet + tokens', hint: 'SOL + all SPL tokens' },
      { value: 'all', label: 'All wallets', hint: 'aggregate view' },
      { value: 'portfolio', label: 'Portfolio', hint: 'total across all wallets' },
      { value: 'back', label: 'Back' },
    ],
  });

  if (p.isCancel(action) || action === 'back') return;

  const { exec } = await import('./helpers.ts');
  switch (action) {
    case 'default': await exec('balance'); break;
    case 'tokens': await exec('balance', '--tokens'); break;
    case 'all': await exec('balance', '--all'); break;
    case 'portfolio': await exec('portfolio'); break;
  }
}

async function sendMenu(): Promise<void> {
  const { requireSession } = await import('../core/session.ts');

  try {
    await requireSession();
  } catch {
    p.log.error('Session required. Run: solblade unlock');
    return;
  }

  const wallets = getAllWallets();
  const defaultW = getDefaultWallet();

  const token = await p.select({
    message: 'What are you sending?',
    options: [
      { value: 'SOL', label: 'SOL' },
      { value: 'custom', label: 'SPL Token', hint: 'enter mint address' },
      { value: 'back', label: 'Back' },
    ],
  });

  if (p.isCancel(token) || token === 'back') return;

  let mintAddr = 'SOL';
  if (token === 'custom') {
    const mint = await p.text({
      message: 'Token mint address',
      placeholder: 'So11111111111111111111111111111111111111112',
    });
    if (p.isCancel(mint)) return;
    mintAddr = mint;
  }

  const amount = await p.text({
    message: `Amount of ${mintAddr === 'SOL' ? 'SOL' : 'tokens'} to send`,
    placeholder: '0.1',
    validate: (v) => {
      if (isNaN(parseFloat(v)) || parseFloat(v) <= 0) return 'Enter a valid amount';
    },
  });
  if (p.isCancel(amount)) return;

  const to = await p.text({
    message: 'Destination address',
    placeholder: 'Solana public key',
    validate: (v) => {
      if (v.length < 32 || v.length > 44) return 'Invalid Solana address';
    },
  });
  if (p.isCancel(to)) return;

  let fromLabel = defaultW?.label ?? '';
  if (wallets.length > 1) {
    const from = await p.select({
      message: 'Send from which wallet?',
      options: wallets.map(w => ({
        value: w.label,
        label: w.label,
        hint: formatAddress(w.pubkey) + (w.is_default ? ' (default)' : ''),
      })),
    });
    if (p.isCancel(from)) return;
    fromLabel = from;
  }

  const confirmed = await p.confirm({
    message: `Send ${amount} ${mintAddr} from ${fromLabel} to ${formatAddress(to as string)}?`,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.log.info('Cancelled.');
    return;
  }

  const { exec } = await import('./helpers.ts');
  await exec('send', amount as string, mintAddr, '--to', to as string, '--from', fromLabel, '-y');
}

async function walletsMenu(): Promise<void> {
  const action = await p.select({
    message: 'Wallet management',
    options: [
      { value: 'list', label: 'List wallets' },
      { value: 'create', label: 'Create new wallet' },
      { value: 'import', label: 'Import wallet', hint: 'private key or seed phrase' },
      { value: 'label', label: 'Rename a wallet' },
      { value: 'default', label: 'Set default wallet' },
      { value: 'group', label: 'Set wallet group' },
      { value: 'remove', label: 'Remove a wallet' },
      { value: 'back', label: 'Back' },
    ],
  });

  if (p.isCancel(action) || action === 'back') return;

  const wallets = getAllWallets();

  switch (action) {
    case 'list': {
      const { exec } = await import('./helpers.ts');
      await exec('list');
      break;
    }
    case 'create': {
      const label = await p.text({
        message: 'Wallet label',
        placeholder: 'trading',
      });
      if (p.isCancel(label)) return;

      const group = await p.text({
        message: 'Group (optional)',
        placeholder: 'press Enter to skip',
        defaultValue: '',
      });
      if (p.isCancel(group)) return;

      const { exec } = await import('./helpers.ts');
      const args = ['-l', label as string];
      if (group) args.push('-g', group as string);
      await exec('create', ...args);
      break;
    }
    case 'import': {
      const method = await p.select({
        message: 'Import method',
        options: [
          { value: 'key', label: 'Private key', hint: 'base58 encoded' },
          { value: 'phrase', label: 'Seed phrase', hint: '12 or 24 words' },
        ],
      });
      if (p.isCancel(method)) return;

      const label = await p.text({ message: 'Wallet label', placeholder: 'imported' });
      if (p.isCancel(label)) return;

      if (method === 'key') {
        const key = await p.password({ message: 'Paste your private key' });
        if (p.isCancel(key)) return;
        const { exec } = await import('./helpers.ts');
        await exec('import', '-k', key, '-l', label as string);
      } else {
        const phrase = await p.password({ message: 'Enter seed phrase' });
        if (p.isCancel(phrase)) return;
        const { exec } = await import('./helpers.ts');
        await exec('import', '-p', phrase, '-l', label as string);
      }
      break;
    }
    case 'label': {
      if (wallets.length === 0) { p.log.warn('No wallets.'); return; }
      const wallet = await selectWallet(wallets, 'Which wallet to rename?');
      if (!wallet) return;
      const newLabel = await p.text({ message: 'New label' });
      if (p.isCancel(newLabel)) return;
      const { exec } = await import('./helpers.ts');
      await exec('label', wallet, newLabel as string);
      break;
    }
    case 'default': {
      if (wallets.length === 0) { p.log.warn('No wallets.'); return; }
      const wallet = await selectWallet(wallets, 'Set which wallet as default?');
      if (!wallet) return;
      const { exec } = await import('./helpers.ts');
      await exec('default', wallet);
      break;
    }
    case 'group': {
      if (wallets.length === 0) { p.log.warn('No wallets.'); return; }
      const wallet = await selectWallet(wallets, 'Which wallet?');
      if (!wallet) return;
      const group = await p.text({ message: 'Group name (leave empty to clear)', defaultValue: '' });
      if (p.isCancel(group)) return;
      const { exec } = await import('./helpers.ts');
      await exec('group', wallet, ...(group ? [group as string] : []));
      break;
    }
    case 'remove': {
      if (wallets.length === 0) { p.log.warn('No wallets.'); return; }
      const wallet = await selectWallet(wallets, 'Which wallet to remove?');
      if (!wallet) return;
      const hard = await p.confirm({ message: 'Permanently delete? (No = archive only)' });
      if (p.isCancel(hard)) return;
      const { exec } = await import('./helpers.ts');
      await exec('remove', wallet, ...(hard ? ['--hard'] : []));
      break;
    }
  }
}

async function cleanupMenu(): Promise<void> {
  const wallets = getAllWallets();
  if (wallets.length === 0) { p.log.warn('No wallets.'); return; }

  const action = await p.select({
    message: 'Cleanup options',
    options: [
      { value: 'scan', label: 'Scan for empty accounts', hint: 'see reclaimable rent' },
      { value: 'burn', label: 'Close empty accounts', hint: 'reclaim SOL' },
      { value: 'back', label: 'Back' },
    ],
  });

  if (p.isCancel(action) || action === 'back') return;

  let wallet: string | undefined;
  if (wallets.length > 1) {
    wallet = await selectWallet(wallets, 'Which wallet?') ?? undefined;
    if (!wallet) return;
  }

  const { exec } = await import('./helpers.ts');
  if (action === 'scan') {
    await exec('cleanup', 'scan', ...(wallet ? [wallet] : []));
  } else {
    const confirmed = await p.confirm({ message: 'Close ALL empty token accounts and reclaim rent?' });
    if (p.isCancel(confirmed) || !confirmed) return;
    await exec('cleanup', 'burn', ...(wallet ? [wallet] : []), '--all');
  }
}

async function swapMenu(): Promise<void> {
  const inputToken = await p.select({
    message: 'Swap from',
    options: [
      { value: 'SOL', label: 'SOL' },
      { value: 'USDC', label: 'USDC' },
      { value: 'custom', label: 'Other token', hint: 'enter symbol or mint' },
      { value: 'back', label: 'Back' },
    ],
  });
  if (p.isCancel(inputToken) || inputToken === 'back') return;

  let input = inputToken;
  if (inputToken === 'custom') {
    const custom = await p.text({ message: 'Token symbol or mint address' });
    if (p.isCancel(custom)) return;
    input = custom;
  }

  const outputToken = await p.select({
    message: 'Swap to',
    options: [
      { value: 'SOL', label: 'SOL' },
      { value: 'USDC', label: 'USDC' },
      { value: 'USDT', label: 'USDT' },
      { value: 'BONK', label: 'BONK' },
      { value: 'custom', label: 'Other token' },
      { value: 'back', label: 'Back' },
    ],
  });
  if (p.isCancel(outputToken) || outputToken === 'back') return;

  let outputStr = outputToken;
  if (outputToken === 'custom') {
    const custom = await p.text({ message: 'Token symbol or mint address' });
    if (p.isCancel(custom)) return;
    outputStr = custom;
  }

  const amount = await p.text({
    message: `Amount of ${input} to swap`,
    placeholder: '1.0',
    validate: (v) => {
      if (isNaN(parseFloat(v)) || parseFloat(v) <= 0) return 'Enter a valid amount';
    },
  });
  if (p.isCancel(amount)) return;

  const { exec } = await import('./helpers.ts');
  await exec('swap', amount as string, input, '--to', outputStr);
}

async function configMenu(): Promise<void> {
  const action = await p.select({
    message: 'Settings',
    options: [
      { value: 'show', label: 'View current config' },
      { value: 'rpc', label: 'Change RPC endpoint' },
      { value: 'session', label: 'Session TTL', hint: 'how long to stay unlocked' },
      { value: 'fees', label: 'Priority fees', hint: 'default and max' },
      { value: 'back', label: 'Back' },
    ],
  });

  if (p.isCancel(action) || action === 'back') return;

  const { exec } = await import('./helpers.ts');

  switch (action) {
    case 'show':
      await exec('config', 'show');
      break;
    case 'rpc': {
      const url = await p.text({
        message: 'New RPC endpoint URL',
        placeholder: 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
        validate: (v) => { if (!v.startsWith('http')) return 'Must start with http'; },
      });
      if (p.isCancel(url)) return;
      await exec('config', 'set-rpc', url as string);
      break;
    }
    case 'session': {
      const ttl = await p.text({
        message: 'Session TTL in minutes',
        placeholder: '30',
        defaultValue: '30',
        validate: (v) => { if (isNaN(parseInt(v))) return 'Must be a number'; },
      });
      if (p.isCancel(ttl)) return;
      await exec('config', 'set', 'sessionTtlMinutes', ttl as string);
      break;
    }
    case 'fees': {
      const fee = await p.text({
        message: 'Default priority fee (SOL)',
        placeholder: '0.00005',
        defaultValue: '0.00005',
      });
      if (p.isCancel(fee)) return;
      await exec('config', 'set', 'defaultPriorityFee', fee as string);
      const maxFee = await p.text({
        message: 'Max priority fee cap (SOL)',
        placeholder: '0.01',
        defaultValue: '0.01',
      });
      if (p.isCancel(maxFee)) return;
      await exec('config', 'set', 'maxPriorityFee', maxFee as string);
      break;
    }
  }
}

async function logMenu(): Promise<void> {
  const { exec } = await import('./helpers.ts');
  await exec('log', '-n', '15');
}

async function selectWallet(
  wallets: ReturnType<typeof getAllWallets>,
  message: string
): Promise<string | null> {
  const choice = await p.select({
    message,
    options: wallets.map(w => ({
      value: w.label,
      label: w.label,
      hint: `${formatAddress(w.pubkey)}${w.is_default ? ' (default)' : ''}`,
    })),
  });
  if (p.isCancel(choice)) return null;
  return choice;
}
