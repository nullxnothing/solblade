import {
  Connection,
  type Commitment,
  type SendOptions,
  type VersionedTransaction,
  type Transaction,
  type SignatureStatus,
} from '@solana/web3.js';
import { loadConfig, updateConfig } from '../utils/config.ts';
import { error as logError, warn } from '../utils/format.ts';

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (connection) return connection;
  const config = loadConfig();
  const endpoint = config.rpcEndpoints[config.activeRpcIndex] ?? config.rpcEndpoints[0];
  if (!endpoint) throw new Error('No RPC endpoints configured. Run: solblade config set-rpc <url>');
  connection = new Connection(endpoint, { commitment: config.confirmationLevel });
  return connection;
}

/**
 * Reset connection (used after config change or failover).
 */
export function resetConnection(): void {
  connection = null;
}

/**
 * Try next RPC endpoint in the failover chain.
 */
export function failover(): boolean {
  const config = loadConfig();
  if (config.rpcEndpoints.length <= 1) return false;
  const nextIndex = (config.activeRpcIndex + 1) % config.rpcEndpoints.length;
  updateConfig({ activeRpcIndex: nextIndex });
  resetConnection();
  warn(`Switched to RPC endpoint: ${config.rpcEndpoints[nextIndex]}`);
  return true;
}

export type SolbladeRpcError =
  | { code: 'BLOCKHASH_NOT_FOUND'; message: string }
  | { code: 'INSUFFICIENT_FUNDS'; message: string; required?: number }
  | { code: 'INSUFFICIENT_FUNDS_FOR_RENT'; message: string; rentRequired?: number }
  | { code: 'ACCOUNT_IN_USE'; message: string }
  | { code: 'TRANSACTION_EXPIRED'; message: string }
  | { code: 'NODE_UNHEALTHY'; message: string }
  | { code: 'RATE_LIMITED'; message: string }
  | { code: 'SIMULATION_FAILED'; message: string; logs?: string[] }
  | { code: 'UNKNOWN'; message: string; raw?: unknown };

/**
 * Normalize raw Solana RPC errors into typed errors.
 */
export function normalizeError(err: unknown): SolbladeRpcError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes('blockhash not found') || lower.includes('blockhash expired')) {
    return { code: 'BLOCKHASH_NOT_FOUND', message: 'Blockhash expired. Retrying with fresh blockhash.' };
  }
  if (lower.includes('insufficient funds for rent') || lower.includes('insufficientfundsforrent')) {
    return { code: 'INSUFFICIENT_FUNDS_FOR_RENT', message: 'Insufficient funds to cover rent.' };
  }
  if (lower.includes('insufficient funds') || lower.includes('0x1')) {
    return { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient balance for this transaction.' };
  }
  if (lower.includes('account in use') || lower.includes('accountinuse')) {
    return { code: 'ACCOUNT_IN_USE', message: 'Account is locked by another transaction. Retrying.' };
  }
  if (lower.includes('transaction expired') || lower.includes('transactionexpired')) {
    return { code: 'TRANSACTION_EXPIRED', message: 'Transaction expired before confirmation.' };
  }
  if (lower.includes('node is unhealthy') || lower.includes('nodeunhealthy') || lower.includes('503')) {
    return { code: 'NODE_UNHEALTHY', message: 'RPC node is unhealthy.' };
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return { code: 'RATE_LIMITED', message: 'RPC rate limit hit. Backing off.' };
  }
  if (lower.includes('simulation failed') || lower.includes('simulationfailed')) {
    const logs = extractLogs(err);
    return { code: 'SIMULATION_FAILED', message: 'Transaction simulation failed.', logs };
  }

  return { code: 'UNKNOWN', message: msg, raw: err };
}

function extractLogs(err: unknown): string[] | undefined {
  if (err && typeof err === 'object' && 'logs' in err) {
    return (err as { logs: string[] }).logs;
  }
  return undefined;
}

/**
 * Send a raw serialized transaction with retry on rate limits and node failover.
 * Does NOT retry on blockhash expiry — the caller must rebuild with a fresh blockhash.
 */
export async function sendRawWithRetry(
  serialized: Buffer,
  opts: { maxRetries?: number } = {}
): Promise<string> {
  const maxRetries = opts.maxRetries ?? 3;
  const conn = getConnection();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const signature = await conn.sendRawTransaction(serialized, {
        skipPreflight: false,
        maxRetries: 0,  // outer loop handles retries — avoid compounding
      });
      return signature;
    } catch (err) {
      const normalized = normalizeError(err);

      switch (normalized.code) {
        case 'BLOCKHASH_NOT_FOUND':
        case 'TRANSACTION_EXPIRED':
          // Caller must rebuild tx with fresh blockhash — we can't do it here
          throw new Error(normalized.message);

        case 'NODE_UNHEALTHY':
          if (failover()) {
            warn('Switched RPC endpoint, retrying...');
            continue;
          }
          break;

        case 'RATE_LIMITED':
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * 2 ** attempt, 10_000);
            warn(`Rate limited. Waiting ${delay}ms...`);
            await Bun.sleep(delay);
            continue;
          }
          break;

        default:
          throw new Error(normalized.message);
      }

      throw new Error(normalized.message);
    }
  }

  throw new Error('Max retries exceeded');
}

// sendWithRetry removed — all callers now use sendRawWithRetry with pre-serialized Buffer

/**
 * Poll for transaction confirmation.
 */
export async function confirmTransaction(
  signature: string,
  commitment: Commitment = 'confirmed',
  timeoutMs = 90_000
): Promise<SignatureStatus> {
  const conn = getConnection();
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([signature]);
    const status = value?.[0];

    if (status) {
      if (status.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }
      if (
        status.confirmationStatus === commitment ||
        status.confirmationStatus === 'finalized'
      ) {
        return status;
      }
    }

    await Bun.sleep(2000);
  }

  throw new Error(`Transaction confirmation timeout after ${timeoutMs}ms`);
}
