import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'fs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  type EncryptedKeyFile,
  KEYS_DIR,
} from './types.ts';
import {
  encrypt,
  decrypt,
  generateSalt,
  generateNonce,
  getDefaultKdfParams,
  deriveKey,
} from '../utils/crypto.ts';
import { ensureDirs } from '../utils/config.ts';

function keyFilePath(pubkey: string): string {
  return `${KEYS_DIR}/${pubkey}.enc`;
}

/**
 * Save a keypair encrypted with the user's password-derived key.
 * Each key file gets its own nonce but uses the session's derived key directly.
 * The kdfParams stored are informational — the actual key derivation uses session salt.
 */
export async function saveKeypair(
  keypair: Keypair,
  derivedKeyHex: string,
  sessionSalt: string
): Promise<void> {
  ensureDirs();
  const pubkey = keypair.publicKey.toBase58();
  const secretKeyB58 = bs58.encode(keypair.secretKey);
  const plaintext = new TextEncoder().encode(secretKeyB58);

  const nonce = generateNonce();
  const keyBuffer = Buffer.from(derivedKeyHex, 'hex');

  const { ciphertext, tag } = await encrypt(plaintext, keyBuffer, nonce);

  const keyFile: EncryptedKeyFile = {
    version: 1,
    pubkey,
    algorithm: 'aes-256-gcm',
    kdf: 'pbkdf2',
    kdfParams: getDefaultKdfParams(sessionSalt),
    nonce,
    ciphertext,
    tag,
  };

  const path = keyFilePath(pubkey);
  writeFileSync(path, JSON.stringify(keyFile, null, 2));

  // Restrict file permissions (best-effort on Windows)
  try { chmodSync(path, 0o600); } catch {}
}

/**
 * Load and decrypt a keypair.
 */
export async function loadKeypair(
  pubkey: string,
  derivedKeyHex: string
): Promise<Keypair> {
  const path = keyFilePath(pubkey);
  if (!existsSync(path)) {
    throw new Error(`Key file not found for ${pubkey}`);
  }

  const raw = readFileSync(path, 'utf-8');
  const keyFile: EncryptedKeyFile = JSON.parse(raw);

  if (keyFile.version !== 1) {
    throw new Error(`Unsupported key file version: ${keyFile.version}`);
  }

  const keyBuffer = Buffer.from(derivedKeyHex, 'hex');
  const decrypted = await decrypt(keyFile.ciphertext, keyFile.tag, keyBuffer, keyFile.nonce);
  const secretKeyB58 = new TextDecoder().decode(decrypted);
  const secretKey = bs58.decode(secretKeyB58);

  return Keypair.fromSecretKey(secretKey);
}

/**
 * Check if an encrypted key file exists.
 */
export function keyExists(pubkey: string): boolean {
  return existsSync(keyFilePath(pubkey));
}

/**
 * Delete an encrypted key file.
 */
export function deleteKeyFile(pubkey: string): void {
  const path = keyFilePath(pubkey);
  if (existsSync(path)) unlinkSync(path);
}

/**
 * Derive the encryption key from a password.
 * This is the key that gets cached in the session, NOT raw keypairs.
 */
export async function deriveEncryptionKey(password: string, salt?: string): Promise<{ key: string; salt: string }> {
  const useSalt = salt ?? generateSalt();
  const keyBuffer = await deriveKey(password, useSalt);
  return { key: keyBuffer.toString('hex'), salt: useSalt };
}

/**
 * Generate a new Solana keypair.
 */
export function generateKeypair(): Keypair {
  return Keypair.generate();
}

/**
 * Import keypair from base58 private key.
 */
export function keypairFromPrivateKey(privateKeyB58: string): Keypair {
  const decoded = bs58.decode(privateKeyB58);
  if (decoded.length === 64) {
    return Keypair.fromSecretKey(decoded);
  }
  if (decoded.length === 32) {
    return Keypair.fromSeed(decoded);
  }
  throw new Error(`Invalid private key length: ${decoded.length} bytes (expected 64 or 32)`);
}

/**
 * Import keypair from BIP39 seed phrase.
 * Uses SHA-512 derivation for Phase 1.
 * TODO: Phase 2 — proper BIP39 + BIP44 with ed25519-hd-key
 */
export function keypairFromSeedPhrase(
  phrase: string,
  _derivationPath?: string
): Keypair {
  const words = phrase.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) {
    throw new Error(`Invalid seed phrase: expected 12 or 24 words, got ${words.length}`);
  }

  const encoder = new TextEncoder();
  const phraseBytes = encoder.encode(phrase.trim());
  const hashBuffer = new Bun.CryptoHasher('sha512').update(phraseBytes).digest();
  const seed = hashBuffer.slice(0, 32);

  return Keypair.fromSeed(seed);
}
