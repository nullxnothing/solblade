import { LAMPORTS_PER_SOL } from '../core/types.ts';

/**
 * Convert SOL to lamports using integer arithmetic.
 * Avoids floating point precision issues (0.1 + 0.2 !== 0.3).
 */
export function solToLamports(sol: number): bigint {
  if (sol < 0) throw new Error('Amount cannot be negative');
  const str = sol.toFixed(9);
  const [whole, frac] = str.split('.');
  const wholeBI = BigInt(whole!) * BigInt(LAMPORTS_PER_SOL);
  const fracBI = BigInt((frac ?? '0').padEnd(9, '0').slice(0, 9));
  return wholeBI + fracBI;
}

export function lamportsToSol(lamports: bigint | number): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

/**
 * Convert token amount to smallest unit using integer arithmetic.
 */
export function tokenToSmallest(amount: number, decimals: number): bigint {
  if (amount < 0) throw new Error('Amount cannot be negative');
  if (decimals === 0) return BigInt(Math.round(amount));
  const str = amount.toFixed(decimals);
  const [whole, frac] = str.split('.');
  const multiplier = BigInt(10 ** decimals);
  const wholeBI = BigInt(whole!) * multiplier;
  const fracStr = (frac ?? '0').padEnd(decimals, '0').slice(0, decimals);
  const fracBI = fracStr.length > 0 ? BigInt(fracStr) : 0n;
  return wholeBI + fracBI;
}

export function smallestToToken(amount: bigint, decimals: number): number {
  return Number(amount) / (10 ** decimals);
}
