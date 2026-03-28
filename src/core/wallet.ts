import { Keypair } from '@solana/web3.js';
import {
  generateKeypair,
  keypairFromPrivateKey,
  keypairFromSeedPhrase,
  saveKeypair,
  loadKeypair,
  deleteKeyFile,
} from './keystore.ts';
import {
  insertWallet,
  getAllWallets,
  getDefaultWallet,
  getWalletsByGroup,
  setDefaultWallet,
  updateWalletLabel,
  updateWalletGroup,
  updateWalletTags,
  archiveWallet as archiveWalletDb,
  deleteWallet as deleteWalletDb,
  resolveWallet,
  type WalletRow,
} from './database.ts';
import { appendEvent } from './database.ts';
import { getSessionSalt } from './session.ts';
import type { WalletCreateOptions, WalletImportOptions } from './types.ts';

function requireSalt(): string {
  const salt = getSessionSalt();
  if (!salt) throw new Error('No active session. Run: solblade unlock');
  return salt;
}

/**
 * Create a new wallet with a fresh keypair.
 */
export async function createWallet(
  derivedKeyHex: string,
  opts: WalletCreateOptions = {}
): Promise<{ pubkey: string; label: string }> {
  const keypair = generateKeypair();
  const pubkey = keypair.publicKey.toBase58();
  const now = new Date().toISOString();
  const label = opts.label ?? pubkey.slice(0, 8);

  await saveKeypair(keypair, derivedKeyHex, requireSalt());

  const isFirst = getAllWallets().length === 0;

  const row: WalletRow = {
    id: crypto.randomUUID(),
    pubkey,
    label,
    tags: JSON.stringify(opts.tags ?? []),
    group_name: opts.groupName ?? null,
    is_default: isFirst ? 1 : 0,
    is_archived: 0,
    ai_access: 'none',
    spend_limit_per_tx: 0,
    spend_limit_per_session: 0,
    rate_limit: 30,
    allowlist: '[]',
    require_confirmation: 1,
    created_at: now,
    updated_at: now,
  };

  insertWallet(row);

  appendEvent({
    timestamp: now,
    eventType: 'wallet.created',
    walletId: row.id,
    actor: 'user',
    correlationId: crypto.randomUUID(),
    payload: { pubkey, label, isDefault: isFirst },
    signature: null,
  });

  return { pubkey, label };
}

/**
 * Import a wallet from private key or seed phrase.
 */
export async function importWallet(
  derivedKeyHex: string,
  opts: WalletImportOptions
): Promise<{ pubkey: string; label: string }> {
  let keypair: Keypair;

  if (opts.privateKey) {
    keypair = keypairFromPrivateKey(opts.privateKey);
  } else if (opts.seedPhrase) {
    keypair = keypairFromSeedPhrase(opts.seedPhrase, opts.derivationPath);
  } else {
    throw new Error('Must provide either privateKey or seedPhrase');
  }

  const pubkey = keypair.publicKey.toBase58();
  const now = new Date().toISOString();
  const label = opts.label ?? pubkey.slice(0, 8);

  // Check for duplicate
  const existing = resolveWallet(pubkey);
  if (existing) {
    throw new Error(`Wallet already exists with label "${existing.label}"`);
  }

  await saveKeypair(keypair, derivedKeyHex, requireSalt());

  const isFirst = getAllWallets().length === 0;

  const row: WalletRow = {
    id: crypto.randomUUID(),
    pubkey,
    label,
    tags: JSON.stringify(opts.tags ?? []),
    group_name: opts.groupName ?? null,
    is_default: isFirst ? 1 : 0,
    is_archived: 0,
    ai_access: 'none',
    spend_limit_per_tx: 0,
    spend_limit_per_session: 0,
    rate_limit: 30,
    allowlist: '[]',
    require_confirmation: 1,
    created_at: now,
    updated_at: now,
  };

  insertWallet(row);

  appendEvent({
    timestamp: now,
    eventType: 'wallet.imported',
    walletId: row.id,
    actor: 'user',
    correlationId: crypto.randomUUID(),
    payload: { pubkey, label, method: opts.privateKey ? 'private_key' : 'seed_phrase' },
    signature: null,
  });

  return { pubkey, label };
}

/**
 * Get the signing keypair for a wallet.
 */
export async function getKeypair(
  identifier: string,
  derivedKeyHex: string
): Promise<Keypair> {
  const wallet = resolveWallet(identifier);
  if (!wallet) throw new Error(`Wallet not found: ${identifier}`);
  return loadKeypair(wallet.pubkey, derivedKeyHex);
}

/**
 * List all wallets.
 */
export function listWallets(group?: string): WalletRow[] {
  if (group) return getWalletsByGroup(group);
  return getAllWallets();
}

/**
 * Set wallet label.
 */
export async function labelWallet(identifier: string, newLabel: string): Promise<void> {
  const wallet = resolveWallet(identifier);
  if (!wallet) throw new Error(`Wallet not found: ${identifier}`);
  updateWalletLabel(wallet.id, newLabel);

  appendEvent({
    timestamp: new Date().toISOString(),
    eventType: 'wallet.labeled',
    walletId: wallet.id,
    actor: 'user',
    correlationId: crypto.randomUUID(),
    payload: { oldLabel: wallet.label, newLabel },
    signature: null,
  });
}

/**
 * Set default wallet.
 */
export async function setDefault(identifier: string): Promise<void> {
  const wallet = resolveWallet(identifier);
  if (!wallet) throw new Error(`Wallet not found: ${identifier}`);
  setDefaultWallet(wallet.id);

  appendEvent({
    timestamp: new Date().toISOString(),
    eventType: 'wallet.default_set',
    walletId: wallet.id,
    actor: 'user',
    correlationId: crypto.randomUUID(),
    payload: { pubkey: wallet.pubkey, label: wallet.label },
    signature: null,
  });
}

/**
 * Archive (soft-delete) a wallet.
 */
export async function removeWallet(identifier: string, hard = false): Promise<void> {
  const wallet = resolveWallet(identifier);
  if (!wallet) throw new Error(`Wallet not found: ${identifier}`);

  if (hard) {
    deleteWalletDb(wallet.id);
    deleteKeyFile(wallet.pubkey);
  } else {
    archiveWalletDb(wallet.id);
  }

  appendEvent({
    timestamp: new Date().toISOString(),
    eventType: 'wallet.removed',
    walletId: wallet.id,
    actor: 'user',
    correlationId: crypto.randomUUID(),
    payload: { pubkey: wallet.pubkey, label: wallet.label, hard },
    signature: null,
  });
}

export { resolveWallet, getDefaultWallet, getAllWallets };
