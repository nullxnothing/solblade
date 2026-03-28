import { Command } from 'commander';
import { loadConfig, updateConfig } from '../utils/config.ts';
import { resetConnection } from '../core/rpc.ts';
import { output, success, error, heading, isJsonMode } from '../utils/format.ts';

export const configCommand = new Command('config')
  .description('View or update configuration');

configCommand
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    if (isJsonMode()) {
      output(config);
    } else {
      heading('Configuration');
      for (const [key, value] of Object.entries(config)) {
        console.log(`  ${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
      }
    }
  });

configCommand
  .command('set-rpc')
  .description('Set RPC endpoint(s)')
  .argument('<urls...>', 'RPC endpoint URL(s)')
  .action((urls: string[]) => {
    updateConfig({ rpcEndpoints: urls, activeRpcIndex: 0 });
    resetConnection();
    if (isJsonMode()) {
      output({ rpcEndpoints: urls });
    } else {
      success(`RPC endpoints set: ${urls.join(', ')}`);
    }
  });

configCommand
  .command('set')
  .description('Set a config value')
  .argument('<key>', 'Config key')
  .argument('<value>', 'Config value')
  .action((key: string, value: string) => {
    const config = loadConfig();
    const validKeys = Object.keys(config);
    if (!validKeys.includes(key)) {
      error(`Invalid config key: ${key}. Valid keys: ${validKeys.join(', ')}`);
      process.exit(1);
    }

    let parsed: unknown = value;
    if (value === 'true') parsed = true;
    else if (value === 'false') parsed = false;
    else if (!isNaN(Number(value))) parsed = Number(value);

    updateConfig({ [key]: parsed } as Partial<typeof config>);
    if (isJsonMode()) {
      output({ [key]: parsed });
    } else {
      success(`${key} = ${parsed}`);
    }
  });
