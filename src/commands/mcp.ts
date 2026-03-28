import { Command } from 'commander';
import { startMcpServer } from '../core/mcp.ts';
import { info, error } from '../utils/format.ts';

export const mcpCommand = new Command('mcp')
  .description('MCP server mode for AI agent integration');

mcpCommand
  .command('serve')
  .description('Start MCP server on stdio')
  .option('--allow <tools>', 'Comma-separated list of allowed tool groups (balance,wallets,price,swap,log) or * for all', '*')
  .action(async (opts) => {
    const allowed = new Set(
      opts.allow === '*' ? ['*'] : opts.allow.split(',').map((t: string) => t.trim())
    );

    // MCP runs on stdio — don't print anything to stdout except MCP protocol
    // Log to stderr instead
    process.stderr.write(`[solblade] MCP server starting. Allowed tools: ${opts.allow}\n`);

    try {
      await startMcpServer(allowed);
    } catch (err) {
      process.stderr.write(`[solblade] MCP server error: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });
