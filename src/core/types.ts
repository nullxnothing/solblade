export interface WalletRecord {
  id: string;
  pubkey: string;
  label: string;
  tags: string[];
  groupName: string | null;
  isDefault: boolean;
  isArchived: boolean;
  aiAccess: 'none' | 'read' | 'transfer';
  spendLimitPerTx: bigint;
  spendLimitPerSession: bigint;
  rateLimit: number;
  allowlist: string[];
  requireConfirmation: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WalletCreateOptions {
  label?: string;
  tags?: string[];
  groupName?: string;
}

export interface WalletImportOptions extends WalletCreateOptions {
  seedPhrase?: string;
  privateKey?: string;
  derivationPath?: string;
}

export interface EncryptedKeyFile {
  version: 1;
  pubkey: string;
  algorithm: 'aes-256-gcm';
  kdf: 'pbkdf2' | 'argon2id';
  kdfParams: {
    salt: string;       // hex
    iterations?: number;
    hash?: string;
    memoryCost?: number;
    timeCost?: number;
    parallelism?: number;
  };
  nonce: string;        // hex, 96-bit
  ciphertext: string;   // hex
  tag: string;          // hex, GCM auth tag
}

export interface SessionData {
  derivedKey: string;   // hex — the AES key, NOT raw keypairs
  expiresAt: number;    // unix timestamp ms
  createdAt: number;
}

export interface AuditEvent {
  id?: number;
  timestamp: string;
  eventType: string;
  walletId: string | null;
  actor: string;
  correlationId: string;
  payload: Record<string, unknown>;
  signature: string | null;
  hash: string;
}

export type EventType =
  | 'session.unlocked'
  | 'session.locked'
  | 'session.expired'
  | 'wallet.created'
  | 'wallet.imported'
  | 'wallet.removed'
  | 'wallet.labeled'
  | 'wallet.default_set'
  | 'transfer.requested'
  | 'transfer.simulated'
  | 'transfer.signed'
  | 'transfer.submitted'
  | 'transfer.confirmed'
  | 'transfer.failed'
  | 'swap.requested'
  | 'swap.confirmed'
  | 'export.key_material';

export interface TokenBalance {
  mint: string;
  symbol: string;
  name: string;
  amount: bigint;
  decimals: number;
  uiAmount: number;
  usdValue: number | null;
}

export interface TransferParams {
  from: string;         // wallet label or pubkey
  to: string;           // destination pubkey
  amount: number;       // in human-readable units (SOL or token amount)
  mint?: string;        // SPL token mint (null = SOL)
  priorityFee?: number; // SOL
  maxPriorityFee?: number;
  skipSimulation?: boolean;
}

export interface TransactionResult {
  signature: string;
  status: 'confirmed' | 'finalized' | 'failed';
  slot: number;
  fee: number;          // lamports
  error: string | null;
}

export interface SolbladeConfig {
  rpcEndpoints: string[];
  activeRpcIndex: number;
  defaultPriorityFee: number;
  maxPriorityFee: number;
  sessionTtlMinutes: number;
  confirmationLevel: 'confirmed' | 'finalized';
  rateLimit: number;     // tx per minute
}

export const DEFAULT_CONFIG: SolbladeConfig = {
  rpcEndpoints: ['https://api.mainnet-beta.solana.com'],
  activeRpcIndex: 0,
  defaultPriorityFee: 0.00005,
  maxPriorityFee: 0.01,
  sessionTtlMinutes: 30,
  confirmationLevel: 'confirmed',
  rateLimit: 30,
};

export const LAMPORTS_PER_SOL = 1_000_000_000;

export const SOLBLADE_DIR = `${Bun.env.HOME || Bun.env.USERPROFILE}/.solblade`;
export const KEYS_DIR = `${SOLBLADE_DIR}/keys`;
export const DB_PATH = `${SOLBLADE_DIR}/solblade.db`;
export const CONFIG_PATH = `${SOLBLADE_DIR}/config.json`;
export const SESSION_PATH = `${SOLBLADE_DIR}/.session`;
