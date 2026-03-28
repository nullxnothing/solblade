/**
 * Jupiter v6 API integration for token swaps.
 * Docs: https://station.jup.ag/docs/apis/swap-api
 */

const JUPITER_API = 'https://quote-api.jup.ag/v6';
const JUPITER_PRICE_API = 'https://price.jup.ag/v6';

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: RoutePlan[];
  contextSlot: number;
}

interface RoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface JupiterSwapResponse {
  swapTransaction: string; // base64 encoded versioned transaction
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export interface TokenPrice {
  id: string;
  mintSymbol: string;
  vsToken: string;
  vsTokenSymbol: string;
  price: number;
}

// Well-known mints
export const KNOWN_MINTS: Record<string, string> = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'PYTH': 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
};

/**
 * Resolve a token symbol or mint address to a mint address.
 */
export function resolveMint(tokenOrMint: string): string {
  const upper = tokenOrMint.toUpperCase();
  return KNOWN_MINTS[upper] ?? tokenOrMint;
}

/**
 * Get a swap quote from Jupiter.
 */
export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps = 50,
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: slippageBps.toString(),
    onlyDirectRoutes: 'false',
    asLegacyTransaction: 'false',
  });

  const res = await fetch(`${JUPITER_API}/quote?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jupiter quote failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<JupiterQuote>;
}

/**
 * Get a swap transaction from Jupiter.
 */
export async function getSwapTransaction(
  quote: JupiterQuote,
  userPublicKey: string,
  opts: {
    wrapUnwrapSOL?: boolean;
    prioritizationFeeLamports?: number | 'auto';
    dynamicComputeUnitLimit?: boolean;
  } = {}
): Promise<JupiterSwapResponse> {
  const body = {
    quoteResponse: quote,
    userPublicKey,
    wrapAndUnwrapSol: opts.wrapUnwrapSOL ?? true,
    dynamicComputeUnitLimit: opts.dynamicComputeUnitLimit ?? true,
    prioritizationFeeLamports: opts.prioritizationFeeLamports ?? 'auto',
  };

  const res = await fetch(`${JUPITER_API}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter swap failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<JupiterSwapResponse>;
}

/**
 * Get token prices in USD from Jupiter Price API.
 */
export async function getTokenPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};

  const params = new URLSearchParams({ ids: mints.join(',') });
  const res = await fetch(`${JUPITER_PRICE_API}/price?${params}`);
  if (!res.ok) return {};

  const data = await res.json() as { data: Record<string, TokenPrice> };
  const prices: Record<string, number> = {};
  for (const [mint, info] of Object.entries(data.data)) {
    prices[mint] = info.price;
  }
  return prices;
}

/**
 * Get a single token price in USD.
 */
export async function getTokenPrice(mint: string): Promise<number | null> {
  const prices = await getTokenPrices([mint]);
  return prices[mint] ?? null;
}

/**
 * Format route plan for display.
 */
export function formatRoute(quote: JupiterQuote): string[] {
  return quote.routePlan.map(r => {
    const pct = r.percent === 100 ? '' : ` (${r.percent}%)`;
    return `${r.swapInfo.label}${pct}`;
  });
}
