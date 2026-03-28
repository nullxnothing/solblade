import { Command } from 'commander';
import { unlockSession, lockSession, getSessionInfo } from '../core/session.ts';
import { output, success, info, isJsonMode } from '../utils/format.ts';

export const unlockCommand = new Command('unlock')
  .description('Unlock the wallet keystore for this session')
  .action(async () => {
    // requireSession handles prompting
    const { requireSession } = await import('../core/session.ts');
    await requireSession();
    const sessionInfo = getSessionInfo();

    if (isJsonMode()) {
      output({ status: 'unlocked', expiresInMinutes: sessionInfo.remainingMinutes });
    } else {
      success(`Session unlocked (${sessionInfo.remainingMinutes} minutes remaining)`);
    }
  });

export const lockCommand = new Command('lock')
  .description('Lock the wallet keystore')
  .action(async () => {
    await lockSession();
    if (isJsonMode()) {
      output({ status: 'locked' });
    } else {
      success('Session locked.');
    }
  });

export const statusCommand = new Command('status')
  .description('Show session status')
  .action(() => {
    const sessionInfo = getSessionInfo();

    if (isJsonMode()) {
      output(sessionInfo);
    } else {
      if (sessionInfo.isActive) {
        info(`Session active (${sessionInfo.remainingMinutes} minutes remaining)`);
      } else {
        info('Session locked. Run: solblade unlock');
      }
    }
  });
