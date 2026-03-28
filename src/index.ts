#!/usr/bin/env bun
import { Command } from 'commander';
import { banner, setJsonMode } from './utils/format.ts';
import { ensureDirs } from './utils/config.ts';

// Commands
import { createCommand } from './commands/create.ts';
import { importCommand } from './commands/import.ts';
import { listCommand } from './commands/list.ts';
import { labelCommand, groupCommand, tagCommand } from './commands/label.ts';
import { defaultCommand } from './commands/default.ts';
import { removeCommand } from './commands/remove.ts';
import { unlockCommand, lockCommand, statusCommand } from './commands/unlock.ts';
import { balanceCommand, portfolioCommand } from './commands/balance.ts';
import { sendCommand } from './commands/send.ts';
import { cleanupCommand } from './commands/cleanup.ts';
import { configCommand } from './commands/config.ts';
import { logCommand } from './commands/log.ts';
import { initCommand } from './commands/init.ts';
import { swapCommand } from './commands/swap.ts';
import { mcpCommand } from './commands/mcp.ts';

ensureDirs();

const program = new Command()
  .name('solblade')
  .version('0.1.0')
  .description('AI-native Solana wallet CLI. Sharp. Fast. AI-Native.')
  .option('--json', 'Output in JSON format')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.json) setJsonMode(true);
  });

// Setup
program.addCommand(initCommand);

// Wallet management
program.addCommand(createCommand);
program.addCommand(importCommand);
program.addCommand(listCommand);
program.addCommand(labelCommand);
program.addCommand(groupCommand);
program.addCommand(tagCommand);
program.addCommand(defaultCommand);
program.addCommand(removeCommand);

// Session
program.addCommand(unlockCommand);
program.addCommand(lockCommand);
program.addCommand(statusCommand);

// Balance & portfolio
program.addCommand(balanceCommand);
program.addCommand(portfolioCommand);

// Transfers
program.addCommand(sendCommand);

// Swap
program.addCommand(swapCommand);

// Cleanup
program.addCommand(cleanupCommand);

// Config
program.addCommand(configCommand);

// MCP server
program.addCommand(mcpCommand);

// Audit log
program.addCommand(logCommand);

// Show banner on help
const originalHelp = program.helpInformation.bind(program);
program.helpInformation = function () {
  banner();
  return originalHelp();
};

// If no subcommand provided, launch interactive menu
const args = process.argv.slice(2);
const hasSubcommand = args.length > 0 && !args[0]!.startsWith('-');
const isHelp = args.includes('--help') || args.includes('-h');
const isVersion = args.includes('--version') || args.includes('-V');

if (!hasSubcommand && !isHelp && !isVersion) {
  import('./commands/menu.ts').then(({ runMenu }) => runMenu());
} else {
  program.parse(process.argv);
}
