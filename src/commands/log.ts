import { Command } from 'commander';
import { getRecentEvents, getEventsByWallet } from '../core/database.ts';
import { resolveWallet } from '../core/wallet.ts';
import { output, heading, table, error, isJsonMode, formatAddress } from '../utils/format.ts';

export const logCommand = new Command('log')
  .description('View audit event log')
  .option('-n, --limit <n>', 'Number of events', '20')
  .option('-w, --wallet <wallet>', 'Filter by wallet')
  .action((opts) => {
    let events;
    if (opts.wallet) {
      const wallet = resolveWallet(opts.wallet);
      if (!wallet) {
        error(`Wallet not found: ${opts.wallet}`);
        process.exit(1);
      }
      events = getEventsByWallet(wallet.id, parseInt(opts.limit));
    } else {
      events = getRecentEvents(parseInt(opts.limit));
    }

    if (isJsonMode()) {
      output(events.map(e => ({
        ...e,
        payload: JSON.parse(e.payload),
      })));
      return;
    }

    if (events.length === 0) {
      output('  No events found.');
      return;
    }

    heading('Audit Log');
    table(events.map(e => ({
      'Time': new Date(e.timestamp).toLocaleString(),
      'Event': e.event_type,
      'Actor': e.actor,
      'Wallet': e.wallet_id ? formatAddress(e.wallet_id) : '-',
      'Sig': e.signature ? formatAddress(e.signature) : '-',
    })));
  });
