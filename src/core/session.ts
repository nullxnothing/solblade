import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'fs';
import { SESSION_PATH } from './types.ts';
import type { SessionData } from './types.ts';
import { loadConfig } from '../utils/config.ts';
import { deriveEncryptionKey } from './keystore.ts';
import { appendEvent } from './database.ts';

let cachedSession: SessionData | null = null;
let cachedSalt: string | null = null;

/**
 * Unlock the session with a password.
 * Derives the AES key and caches it (NOT raw keypairs).
 */
export async function unlockSession(password: string): Promise<string> {
  const existing = loadSession();
  const salt = existing ? loadSessionSalt() : undefined;

  const { key, salt: usedSalt } = await deriveEncryptionKey(password, salt ?? undefined);

  const config = loadConfig();
  const ttl = config.sessionTtlMinutes * 60 * 1000;
  const now = Date.now();

  const session: SessionData = {
    derivedKey: key,
    expiresAt: now + ttl,
    createdAt: now,
  };

  const sessionFile = { ...session, salt: usedSalt };
  writeFileSync(SESSION_PATH, JSON.stringify(sessionFile));
  try { chmodSync(SESSION_PATH, 0o600); } catch {}

  cachedSession = session;
  cachedSalt = usedSalt;

  appendEvent({
    timestamp: new Date().toISOString(),
    eventType: 'session.unlocked',
    walletId: null,
    actor: 'user',
    correlationId: crypto.randomUUID(),
    payload: { ttlMinutes: config.sessionTtlMinutes },
    signature: null,
  });

  return key;
}

/**
 * Get the derived encryption key from active session.
 */
export function getSessionKey(): string | null {
  if (cachedSession && cachedSession.expiresAt > Date.now()) {
    return cachedSession.derivedKey;
  }

  const session = loadSession();
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    // Sync cleanup — don't call async lockSession here
    cachedSession = null;
    cachedSalt = null;
    try { unlinkSync(SESSION_PATH); } catch {}
    return null;
  }

  cachedSession = session;
  cachedSalt = loadSessionSalt();
  return session.derivedKey;
}

/**
 * Get the session salt (needed for encrypting new key files).
 */
export function getSessionSalt(): string | null {
  if (cachedSalt) return cachedSalt;
  return loadSessionSalt();
}

/**
 * Check if there's an active session.
 */
export function isSessionActive(): boolean {
  return getSessionKey() !== null;
}

/**
 * Lock the session (clear derived key).
 */
export async function lockSession(): Promise<void> {
  cachedSession = null;
  cachedSalt = null;
  if (existsSync(SESSION_PATH)) {
    unlinkSync(SESSION_PATH);
  }
  appendEvent({
    timestamp: new Date().toISOString(),
    eventType: 'session.locked',
    walletId: null,
    actor: 'user',
    correlationId: crypto.randomUUID(),
    payload: {},
    signature: null,
  });
}

/**
 * Get session info for display.
 */
export function getSessionInfo(): { isActive: boolean; expiresAt: number | null; remainingMinutes: number | null } {
  const session = loadSession();
  if (!session || session.expiresAt <= Date.now()) {
    return { isActive: false, expiresAt: null, remainingMinutes: null };
  }
  const remaining = Math.ceil((session.expiresAt - Date.now()) / 60_000);
  return { isActive: true, expiresAt: session.expiresAt, remainingMinutes: remaining };
}

function loadSession(): SessionData | null {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    const raw = readFileSync(SESSION_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return {
      derivedKey: data.derivedKey,
      expiresAt: data.expiresAt,
      createdAt: data.createdAt,
    };
  } catch {
    return null;
  }
}

function loadSessionSalt(): string | null {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    const raw = readFileSync(SESSION_PATH, 'utf-8');
    return JSON.parse(raw).salt ?? null;
  } catch {
    return null;
  }
}

/**
 * Prompt user for password if no active session.
 */
export async function requireSession(): Promise<string> {
  const key = getSessionKey();
  if (key) return key;

  if (process.env.SOLBLADE_PASSWORD) {
    return unlockSession(process.env.SOLBLADE_PASSWORD);
  }

  const { password } = await import('@clack/prompts').then(p => ({
    password: p.password,
  }));

  const pw = await password({
    message: 'Enter keystore password',
  });

  if (typeof pw === 'symbol') {
    process.exit(0);
  }

  return unlockSession(pw);
}
