import { execSync } from 'child_process';
import { resolve } from 'path';

const ENTRY = resolve(import.meta.dir, '..', 'index.ts');

/**
 * Execute a solblade subcommand inline, inheriting stdio.
 */
export async function exec(command: string, ...args: string[]): Promise<void> {
  const cmd = `bun run "${ENTRY}" ${command} ${args.map(a => `"${a}"`).join(' ')}`;
  try {
    execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
  } catch {
    // Command already printed its own error
  }
}
