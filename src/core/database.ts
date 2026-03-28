import { Database } from 'bun:sqlite';
import { DB_PATH } from './types.ts';
import type { AuditEvent } from './types.ts';
import { ensureDirs } from '../utils/config.ts';

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;
  ensureDirs();
  db = new Database(DB_PATH);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

process.on('exit', closeDb);

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `);

  const row = db.query('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null } | null;
  const currentVersion = row?.v ?? 0;

  if (currentVersion < 1) {
    // Wrap migration in a transaction for atomicity
    db.transaction(() => {
      db.run(`
        CREATE TABLE wallets (
          id TEXT PRIMARY KEY,
          pubkey TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          group_name TEXT,
          is_default INTEGER NOT NULL DEFAULT 0,
          is_archived INTEGER NOT NULL DEFAULT 0,
          ai_access TEXT NOT NULL DEFAULT 'none',
          spend_limit_per_tx INTEGER NOT NULL DEFAULT 0,
          spend_limit_per_session INTEGER NOT NULL DEFAULT 0,
          rate_limit INTEGER NOT NULL DEFAULT 30,
          allowlist TEXT NOT NULL DEFAULT '[]',
          require_confirmation INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      db.run(`
        CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          event_type TEXT NOT NULL,
          wallet_id TEXT,
          actor TEXT NOT NULL,
          correlation_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          signature TEXT,
          hash TEXT NOT NULL
        )
      `);

      db.run(`CREATE INDEX idx_events_type ON events(event_type)`);
      db.run(`CREATE INDEX idx_events_wallet ON events(wallet_id)`);
      db.run(`CREATE INDEX idx_events_correlation ON events(correlation_id)`);
      db.run(`CREATE INDEX idx_events_timestamp ON events(timestamp)`);
      db.run(`CREATE INDEX idx_wallets_label ON wallets(label)`);
      db.run(`CREATE INDEX idx_wallets_group ON wallets(group_name)`);
      db.run(`CREATE INDEX idx_wallets_default ON wallets(is_default)`);

      db.run('INSERT INTO schema_version (version) VALUES (1)');
    })();
  }
}

// --- Sync SHA-256 for event chain (avoids race condition with async) ---

function sha256Sync(data: string): string {
  return new Bun.CryptoHasher('sha256').update(data).digest('hex');
}

// --- Wallet DB operations ---

export interface WalletRow {
  id: string;
  pubkey: string;
  label: string;
  tags: string;
  group_name: string | null;
  is_default: number;
  is_archived: number;
  ai_access: string;
  spend_limit_per_tx: number;
  spend_limit_per_session: number;
  rate_limit: number;
  allowlist: string;
  require_confirmation: number;
  created_at: string;
  updated_at: string;
}

export function insertWallet(wallet: WalletRow): void {
  getDb().run(
    `INSERT INTO wallets (id, pubkey, label, tags, group_name, is_default, is_archived,
     ai_access, spend_limit_per_tx, spend_limit_per_session, rate_limit, allowlist,
     require_confirmation, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      wallet.id, wallet.pubkey, wallet.label, wallet.tags, wallet.group_name,
      wallet.is_default, wallet.is_archived, wallet.ai_access,
      wallet.spend_limit_per_tx, wallet.spend_limit_per_session, wallet.rate_limit,
      wallet.allowlist, wallet.require_confirmation, wallet.created_at, wallet.updated_at,
    ]
  );
}

export function getAllWallets(includeArchived = false): WalletRow[] {
  const clause = includeArchived ? '' : 'WHERE is_archived = 0';
  return getDb().query(`SELECT * FROM wallets ${clause} ORDER BY created_at ASC`).all() as WalletRow[];
}

export function getWalletByLabel(label: string): WalletRow | null {
  return getDb().query('SELECT * FROM wallets WHERE label = ? AND is_archived = 0').get(label) as WalletRow | null;
}

export function getWalletByPubkey(pubkey: string): WalletRow | null {
  return getDb().query('SELECT * FROM wallets WHERE pubkey = ? AND is_archived = 0').get(pubkey) as WalletRow | null;
}

export function getDefaultWallet(): WalletRow | null {
  return getDb().query('SELECT * FROM wallets WHERE is_default = 1 AND is_archived = 0').get() as WalletRow | null;
}

export function getWalletsByGroup(groupName: string): WalletRow[] {
  return getDb().query('SELECT * FROM wallets WHERE group_name = ? AND is_archived = 0 ORDER BY label ASC').all(groupName) as WalletRow[];
}

export function setDefaultWallet(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.run('UPDATE wallets SET is_default = 0');
    db.run('UPDATE wallets SET is_default = 1 WHERE id = ?', [id]);
  })();
}

export function updateWalletLabel(id: string, label: string): void {
  getDb().run('UPDATE wallets SET label = ?, updated_at = ? WHERE id = ?', [label, new Date().toISOString(), id]);
}

export function updateWalletGroup(id: string, groupName: string | null): void {
  getDb().run('UPDATE wallets SET group_name = ?, updated_at = ? WHERE id = ?', [groupName, new Date().toISOString(), id]);
}

export function updateWalletTags(id: string, tags: string[]): void {
  getDb().run('UPDATE wallets SET tags = ?, updated_at = ? WHERE id = ?', [JSON.stringify(tags), new Date().toISOString(), id]);
}

export function archiveWallet(id: string): void {
  getDb().run('UPDATE wallets SET is_archived = 1, is_default = 0, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
}

export function deleteWallet(id: string): void {
  getDb().run('DELETE FROM wallets WHERE id = ?', [id]);
}

/**
 * Resolve a wallet by label or pubkey prefix.
 */
export function resolveWallet(identifier: string): WalletRow | null {
  if (!identifier || identifier.length < 2) return null;

  const byLabel = getWalletByLabel(identifier);
  if (byLabel) return byLabel;

  const byPubkey = getWalletByPubkey(identifier);
  if (byPubkey) return byPubkey;

  // Prefix match requires at least 4 chars
  if (identifier.length < 4) return null;
  const byPrefix = getDb().query(
    'SELECT * FROM wallets WHERE pubkey LIKE ? AND is_archived = 0 LIMIT 2'
  ).all(`${identifier}%`) as WalletRow[];
  if (byPrefix.length === 1) return byPrefix[0]!;

  return null;
}

// --- Event log operations (synchronous + transactional for tamper-evident chain) ---

export function appendEvent(event: Omit<AuditEvent, 'id' | 'hash'>): void {
  const db = getDb();
  const sig = event.signature ?? '';

  db.transaction(() => {
    const lastEvent = db.query('SELECT hash FROM events ORDER BY id DESC LIMIT 1').get() as { hash: string } | null;
    const previousHash = lastEvent?.hash ?? '0'.repeat(64);

    const content = `${previousHash}|${event.timestamp}|${event.eventType}|${event.walletId ?? ''}|${event.actor}|${event.correlationId}|${JSON.stringify(event.payload)}|${sig}`;
    const hash = sha256Sync(content);

    db.run(
      `INSERT INTO events (timestamp, event_type, wallet_id, actor, correlation_id, payload, signature, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.timestamp, event.eventType, event.walletId, event.actor,
        event.correlationId, JSON.stringify(event.payload), sig || null, hash,
      ]
    );
  })();
}

export function getRecentEvents(limit = 50): EventRow[] {
  return getDb().query('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit) as EventRow[];
}

export function getEventsByWallet(walletId: string, limit = 50): EventRow[] {
  return getDb().query('SELECT * FROM events WHERE wallet_id = ? ORDER BY id DESC LIMIT ?').all(walletId, limit) as EventRow[];
}

export function getEventsByCorrelation(correlationId: string): EventRow[] {
  return getDb().query('SELECT * FROM events WHERE correlation_id = ? ORDER BY id ASC').all(correlationId) as EventRow[];
}

interface EventRow {
  id: number;
  timestamp: string;
  event_type: string;
  wallet_id: string | null;
  actor: string;
  correlation_id: string;
  payload: string;
  signature: string | null;
  hash: string;
}
