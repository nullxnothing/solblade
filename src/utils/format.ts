import chalk from 'chalk';
import { LAMPORTS_PER_SOL } from '../core/types.ts';

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function output(data: unknown): void {
  if (jsonMode) {
    console.log(JSON.stringify(data, bigIntReplacer, 2));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, bigIntReplacer, 2));
  }
}

export function success(msg: string): void {
  if (jsonMode) return;
  console.log(chalk.green(`  ${msg}`));
}

export function warn(msg: string): void {
  if (jsonMode) return;
  console.log(chalk.yellow(`  ${msg}`));
}

export function error(msg: string): void {
  console.error(chalk.red(`  ${msg}`));
}

export function info(msg: string): void {
  if (jsonMode) return;
  console.log(chalk.gray(`  ${msg}`));
}

export function heading(msg: string): void {
  if (jsonMode) return;
  console.log(chalk.bold.cyan(`\n  ${msg}`));
  console.log(chalk.gray(`  ${'─'.repeat(msg.length + 2)}`));
}

export function formatSol(lamports: number | bigint): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL;
  return `${sol.toFixed(9)} SOL`;
}

export function formatSolShort(lamports: number | bigint): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL;
  if (sol === 0) return '0 SOL';
  if (sol < 0.001) return `${sol.toFixed(6)} SOL`;
  if (sol < 1) return `${sol.toFixed(4)} SOL`;
  return `${sol.toFixed(3)} SOL`;
}

export function formatAddress(address: string, length = 8): string {
  if (address.length <= length * 2 + 3) return address;
  return `${address.slice(0, length)}...${address.slice(-length)}`;
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function table(rows: Record<string, string>[]): void {
  if (jsonMode) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    info('No results.');
    return;
  }

  const keys = Object.keys(rows[0]!);
  const widths: Record<string, number> = {};
  for (const key of keys) {
    widths[key] = Math.max(key.length, ...rows.map(r => (r[key] ?? '').length));
  }

  const header = keys.map(k => chalk.bold(k.padEnd(widths[k]!))).join('  ');
  const separator = keys.map(k => '─'.repeat(widths[k]!)).join('──');

  console.log(`  ${header}`);
  console.log(chalk.gray(`  ${separator}`));
  for (const row of rows) {
    const line = keys.map(k => (row[k] ?? '').padEnd(widths[k]!)).join('  ');
    console.log(`  ${line}`);
  }
}

export function banner(): void {
  if (jsonMode) return;
  const blade = chalk.cyan;
  const accent = chalk.magenta;
  const dim = chalk.gray;

  console.log('');
  console.log(blade('   ┌──────────────────────────────────────────────────┐'));
  console.log(blade('   │') + accent('  ╔═╗ ╔═╗ ╦   ╔╗  ╦   ╔═╗ ╔╦╗ ╔═╗              ') + blade('│'));
  console.log(blade('   │') + accent('  ╚═╗ ║ ║ ║   ╠╩╗ ║   ╠═╣  ║║ ║╣               ') + blade('│'));
  console.log(blade('   │') + accent('  ╚═╝ ╚═╝ ╩═╝ ╚═╝ ╩═╝ ╩ ╩ ═╩╝ ╚═╝              ') + blade('│'));
  console.log(blade('   │') + dim('                                                  ') + blade('│'));
  console.log(blade('   │') + dim('       ╱╲                                         ') + blade('│'));
  console.log(blade('   │') + dim('      ╱') + accent('◆◆') + dim('╲   ') + chalk.white.bold('Sharp. Fast. AI-Native.') + dim('              ') + blade('│'));
  console.log(blade('   │') + dim('     ╱') + accent('◆◆◆◆') + dim('╲  ') + dim('v0.1.0') + dim('                          ') + blade('│'));
  console.log(blade('   │') + dim('    ╱──────╲                                      ') + blade('│'));
  console.log(blade('   │') + dim('       ██                                         ') + blade('│'));
  console.log(blade('   └──────────────────────────────────────────────────┘'));
  console.log('');
}

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
