/**
 * Crypto utilities for Solblade keystore.
 * Uses Web Crypto API (AES-256-GCM) + PBKDF2 for deterministic key derivation.
 */

const PBKDF2_ITERATIONS = 600_000;

export interface KdfParams {
  salt: string;
  iterations: number;
  hash: string;
}

export function generateSalt(): string {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return Buffer.from(salt).toString('hex');
}

export function generateNonce(): string {
  const nonce = new Uint8Array(12); // 96-bit for GCM
  crypto.getRandomValues(nonce);
  return Buffer.from(nonce).toString('hex');
}

/**
 * Derive a 256-bit AES key from password using PBKDF2-SHA256.
 * Deterministic: same password + salt always produces same key.
 */
export async function deriveKey(password: string, salt: string): Promise<Buffer> {
  const saltBytes = Buffer.from(salt, 'hex');
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    256
  );

  return Buffer.from(bits);
}

export function getDefaultKdfParams(salt: string): KdfParams {
  return {
    salt,
    iterations: PBKDF2_ITERATIONS,
    hash: 'SHA-256',
  };
}

/**
 * Encrypt data with AES-256-GCM.
 */
export async function encrypt(
  plaintext: Uint8Array,
  keyBytes: Buffer,
  nonceHex: string
): Promise<{ ciphertext: string; tag: string }> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const nonce = Buffer.from(nonceHex, 'hex');
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    plaintext
  );

  // AES-GCM appends 16-byte auth tag to ciphertext
  const encryptedBytes = new Uint8Array(encrypted);
  const ciphertext = encryptedBytes.slice(0, -16);
  const tag = encryptedBytes.slice(-16);

  return {
    ciphertext: Buffer.from(ciphertext).toString('hex'),
    tag: Buffer.from(tag).toString('hex'),
  };
}

/**
 * Decrypt data with AES-256-GCM.
 * Throws if authentication fails (tampered data).
 */
export async function decrypt(
  ciphertextHex: string,
  tagHex: string,
  keyBytes: Buffer,
  nonceHex: string
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const nonce = Buffer.from(nonceHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  // Reconstruct the combined ciphertext+tag that Web Crypto expects
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    combined
  );

  return new Uint8Array(decrypted);
}

/**
 * SHA-256 hash for event log chain.
 */
export async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Buffer.from(hash).toString('hex');
}
