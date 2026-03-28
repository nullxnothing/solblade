/**
 * MCP Server for Solblade.
 * Exposes wallet operations as MCP tools for AI agents.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  getAllWallets,
  getDefaultWallet,
  resolveWallet,
  getRecentEvents,
} from './database.ts';
import { getConnection } from './rpc.ts';
import { lamportsToSol } from '../utils/amount.ts';
import { formatAddress } from '../utils/format.ts';
import {
  getQuote,
  getSwapTransaction,
  resolveMint,
  getTokenPrices,
  getTokenPrice,
  formatRoute,
  KNOWN_MINTS,
} from './jupiter.ts';

export async function startMcpServer(allowedTools: Set<string>): Promise<void> {
  const server = new McpServer({
    name: 'solblade',
    version: '0.1.0',
  });

  // --- Read Tools (always safe) ---

  if (allowedTools.has('balance') || allowedTools.has('*')) {
    server.tool(
      'get_balance',
      'Get SOL balance for a wallet by label or pubkey',
      { wallet: z.string().describe('Wallet label or pubkey. Omit for default wallet.').optional() },
      async ({ wallet }) => {
        const w = wallet ? resolveWallet(wallet) : getDefaultWallet();
        if (!w) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Wallet not found' }) }] };

        const conn = getConnection();
        const lamports = await conn.getBalance(new PublicKey(w.pubkey));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              label: w.label,
              pubkey: w.pubkey,
              sol: lamportsToSol(BigInt(lamports)),
              lamports,
            }),
          }],
        };
      }
    );
  }

  if (allowedTools.has('balance') || allowedTools.has('*')) {
    server.tool(
      'get_all_balances',
      'Get SOL balances for all wallets',
      {},
      async () => {
        const wallets = getAllWallets();
        const conn = getConnection();
        const pubkeys = wallets.map(w => new PublicKey(w.pubkey));
        const results: { label: string; pubkey: string; sol: number }[] = [];
        let total = 0;

        for (let i = 0; i < pubkeys.length; i += 100) {
          const batch = pubkeys.slice(i, i + 100);
          const accounts = await conn.getMultipleAccountsInfo(batch);
          for (let j = 0; j < accounts.length; j++) {
            const sol = lamportsToSol(BigInt(accounts[j]?.lamports ?? 0));
            total += sol;
            results.push({ label: wallets[i + j]!.label, pubkey: wallets[i + j]!.pubkey, sol });
          }
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ wallets: results, totalSol: total }) }],
        };
      }
    );
  }

  if (allowedTools.has('balance') || allowedTools.has('*')) {
    server.tool(
      'get_token_balances',
      'Get all SPL token balances for a wallet',
      { wallet: z.string().describe('Wallet label or pubkey').optional() },
      async ({ wallet }) => {
        const w = wallet ? resolveWallet(wallet) : getDefaultWallet();
        if (!w) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Wallet not found' }) }] };

        const conn = getConnection();
        const pubkey = new PublicKey(w.pubkey);
        const tokenAccounts = await conn.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID });

        const tokens = tokenAccounts.value
          .map(ta => {
            const info = ta.account.data.parsed?.info;
            if (!info) return null;
            return {
              mint: info.mint,
              amount: info.tokenAmount.amount,
              decimals: info.tokenAmount.decimals,
              uiAmount: info.tokenAmount.uiAmount,
            };
          })
          .filter((t): t is NonNullable<typeof t> => t !== null && Number(t.amount) > 0);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ wallet: w.label, tokens }) }],
        };
      }
    );
  }

  if (allowedTools.has('wallets') || allowedTools.has('*')) {
    server.tool(
      'list_wallets',
      'List all wallets with labels, groups, and tags',
      {},
      async () => {
        const wallets = getAllWallets();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(wallets.map(w => ({
              label: w.label,
              pubkey: w.pubkey,
              group: w.group_name,
              tags: JSON.parse(w.tags),
              isDefault: w.is_default === 1,
              aiAccess: w.ai_access,
            }))),
          }],
        };
      }
    );
  }

  if (allowedTools.has('price') || allowedTools.has('*')) {
    server.tool(
      'get_token_price',
      'Get current USD price of a token',
      { token: z.string().describe('Token symbol (SOL, USDC, BONK) or mint address') },
      async ({ token }) => {
        const mint = resolveMint(token);
        const price = await getTokenPrice(mint);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ token, mint, priceUsd: price }),
          }],
        };
      }
    );
  }

  if (allowedTools.has('swap') || allowedTools.has('*')) {
    server.tool(
      'get_swap_quote',
      'Get a Jupiter swap quote (read-only, does not execute)',
      {
        inputToken: z.string().describe('Input token symbol or mint'),
        outputToken: z.string().describe('Output token symbol or mint'),
        amount: z.number().describe('Amount of input token'),
        slippageBps: z.number().optional().describe('Slippage in basis points (default 50)'),
      },
      async ({ inputToken, outputToken, amount, slippageBps }) => {
        const inputMint = resolveMint(inputToken);
        const outputMint = resolveMint(outputToken);
        const isInputSol = inputMint === KNOWN_MINTS['SOL'];

        // Resolve decimals for input token
        let inputDecimals = 9;
        if (!isInputSol) {
          const knownDec: Record<string, number> = {
            [KNOWN_MINTS['USDC']!]: 6, [KNOWN_MINTS['USDT']!]: 6,
            [KNOWN_MINTS['BONK']!]: 5, [KNOWN_MINTS['JUP']!]: 6,
            [KNOWN_MINTS['WIF']!]: 6, [KNOWN_MINTS['PYTH']!]: 6,
          };
          if (knownDec[inputMint] !== undefined) {
            inputDecimals = knownDec[inputMint]!;
          } else {
            try {
              const conn = getConnection();
              const info = await conn.getParsedAccountInfo(new PublicKey(inputMint));
              const data = info.value?.data;
              if (data && typeof data === 'object' && 'parsed' in data) {
                inputDecimals = data.parsed?.info?.decimals ?? 6;
              }
            } catch { inputDecimals = 6; }
          }
        }

        const inputAmountRaw = BigInt(Math.round(amount * (10 ** inputDecimals))).toString();

        const quote = await getQuote(inputMint, outputMint, inputAmountRaw, slippageBps ?? 50);
        const route = formatRoute(quote);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              input: { token: inputToken, amount, mint: inputMint },
              output: { token: outputToken, outAmount: quote.outAmount, mint: outputMint },
              route,
              priceImpact: quote.priceImpactPct,
              slippageBps: quote.slippageBps,
            }),
          }],
        };
      }
    );
  }

  if (allowedTools.has('log') || allowedTools.has('*')) {
    server.tool(
      'get_audit_log',
      'Get recent audit log events',
      { limit: z.number().optional().describe('Number of events (default 20)') },
      async ({ limit }) => {
        const events = getRecentEvents(limit ?? 20);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(events.map(e => ({
              ...e,
              payload: JSON.parse(e.payload),
            }))),
          }],
        };
      }
    );
  }

  // --- Write Tools (require AI permissions on wallet) ---
  // These are gated — only exposed if 'transfer' or 'swap' is in allowedTools

  // Note: Write tools (send_sol, execute_swap) require session unlock
  // and AI permission checks. For Phase 1, we expose read-only tools.
  // Phase 2 will add write tools with spend limits and confirmation gates.

  // Start server on stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
