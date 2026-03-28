# Solblade MCP Server Architecture

## Executive Summary

Solblade's MCP server turns any AI agent (Claude, GPT, local models) into a scoped Solana wallet operator. The key differentiator: **CLI-native, per-wallet permission scoping with tamper-evident audit trails**. No other project combines a CLI wallet, MCP protocol, granular spend controls, and a rent reclaim engine.

The architecture is organized into four tool groups, a layered permission model, and a confirmation gate system that makes AI wallet access both powerful and safe.

---

## 1. Complete Tool Taxonomy

### Group 1: READ Tools (no session required, respects `ai_access != 'none'`)

#### `get_balance`
```typescript
{
  name: "get_balance",
  description: "Get SOL balance for a wallet by label, pubkey, or prefix",
  inputSchema: {
    wallet: z.string().optional().describe("Wallet label, pubkey, or 4+ char prefix. Omit for default wallet."),
  },
  returns: { wallet: string, pubkey: string, balanceSol: number, balanceLamports: string, balanceUsd: number | null }
}
```

#### `get_all_balances`
```typescript
{
  name: "get_all_balances",
  description: "Get SOL balances for all AI-accessible wallets with portfolio total",
  inputSchema: {},
  returns: { wallets: Array<{ label, pubkey, balanceSol, balanceUsd }>, totalSol: number, totalUsd: number | null }
}
```

#### `get_token_balances`
```typescript
{
  name: "get_token_balances",
  description: "Get all SPL token balances for a wallet",
  inputSchema: {
    wallet: z.string().optional(),
    includeZero: z.boolean().optional().default(false).describe("Include zero-balance token accounts"),
  },
  returns: { wallet: string, tokens: Array<{ mint, symbol, balance, decimals, usdValue }>, totalUsdValue: number | null }
}
```

#### `list_wallets`
```typescript
{
  name: "list_wallets",
  description: "List all wallets with labels, groups, tags, and AI access levels",
  inputSchema: {
    group: z.string().optional().describe("Filter by group name"),
    tag: z.string().optional().describe("Filter by tag"),
    includeArchived: z.boolean().optional().default(false),
  },
  returns: { wallets: Array<{ label, pubkey, group, tags, isDefault, aiAccess, spendLimitPerTx, spendLimitPerSession }> }
}
```

#### `get_token_price`
```typescript
{
  name: "get_token_price",
  description: "Get current USD price for a token by symbol or mint address",
  inputSchema: {
    token: z.string().describe("Token symbol (SOL, USDC, BONK) or mint address"),
  },
  returns: { token: string, mint: string, priceUsd: number, source: string }
}
```

#### `get_swap_quote`
```typescript
{
  name: "get_swap_quote",
  description: "Get a Jupiter swap quote without executing. Shows route, price impact, fees.",
  inputSchema: {
    inputToken: z.string().describe("Input token symbol or mint"),
    outputToken: z.string().describe("Output token symbol or mint"),
    amount: z.number().positive().describe("Amount of input token to swap"),
    slippageBps: z.number().int().min(1).max(5000).optional().default(50),
  },
  returns: { inputToken, outputToken, inputAmount, outputAmount, priceImpactPct, route: string[], minimumReceived, platformFee }
}
```

#### `get_transaction_history`
```typescript
{
  name: "get_transaction_history",
  description: "Get recent on-chain transaction history for a wallet",
  inputSchema: {
    wallet: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional().default(10),
  },
  returns: { wallet: string, transactions: Array<{ signature, blockTime, type, amount, counterparty, status }> }
}
```

#### `get_account_info`
```typescript
{
  name: "get_account_info",
  description: "Get detailed account info: owner program, data size, rent status, executable flag",
  inputSchema: {
    address: z.string().describe("Any Solana address or wallet label"),
  },
  returns: { address, ownerProgram, lamports, dataSize, executable, rentEpoch, isRentExempt }
}
```

### Group 2: WRITE Tools (session required, respects `ai_access == 'transfer'`, enforces limits)

#### `send_sol`
```typescript
{
  name: "send_sol",
  description: "Send SOL from a wallet. Subject to spend limits and confirmation gates.",
  inputSchema: {
    from: z.string().optional().describe("Source wallet label/pubkey. Omit for default."),
    to: z.string().describe("Destination pubkey or wallet label"),
    amount: z.number().positive().describe("Amount in SOL"),
    priorityFee: z.number().optional().describe("Priority fee in SOL. Capped by config.maxPriorityFee"),
    memo: z.string().max(256).optional().describe("On-chain memo for the transfer"),
  },
  // Pre-flight checks before execution:
  // 1. Wallet ai_access == 'transfer'
  // 2. amount <= spend_limit_per_tx (if set, 0 = unlimited)
  // 3. session_total + amount <= spend_limit_per_session (if set)
  // 4. Rate limit not exceeded
  // 5. If require_confirmation == true → return confirmation request
  // 6. Destination not in denylist (future)
  returns: { signature: string, from: string, to: string, amountSol: number, fee: number, status: "confirmed" | "finalized" }
}
```

#### `send_token`
```typescript
{
  name: "send_token",
  description: "Send SPL tokens from a wallet. Creates associated token account if needed.",
  inputSchema: {
    from: z.string().optional(),
    to: z.string().describe("Destination pubkey"),
    token: z.string().describe("Token symbol or mint address"),
    amount: z.number().positive(),
    memo: z.string().max(256).optional(),
  },
  // Same permission checks as send_sol, spend limit checked against USD value
  returns: { signature, from, to, token, amount, status }
}
```

#### `execute_swap`
```typescript
{
  name: "execute_swap",
  description: "Execute a Jupiter swap. Gets fresh quote at execution time.",
  inputSchema: {
    wallet: z.string().optional(),
    inputToken: z.string(),
    outputToken: z.string(),
    amount: z.number().positive(),
    slippageBps: z.number().int().min(1).max(5000).optional().default(50),
    memo: z.string().max(256).optional(),
  },
  // Spend limit checked against input token USD value
  returns: { signature, inputToken, outputToken, inputAmount, outputAmount, priceImpactPct, status }
}
```

#### `close_token_account`
```typescript
{
  name: "close_token_account",
  description: "Close an empty SPL token account to reclaim rent SOL",
  inputSchema: {
    wallet: z.string().optional(),
    tokenAccount: z.string().describe("Token account address to close"),
  },
  // Only works on accounts with 0 balance
  returns: { signature, closedAccount: string, reclaimedLamports: string, reclaimedSol: number }
}
```

#### `close_token_accounts_bulk`
```typescript
{
  name: "close_token_accounts_bulk",
  description: "Close multiple empty token accounts in batched transactions. The rent reclaim power tool.",
  inputSchema: {
    wallet: z.string().optional(),
    tokenAccounts: z.array(z.string()).max(20).optional()
      .describe("Specific accounts to close. Omit to close ALL empty accounts for wallet."),
    dryRun: z.boolean().optional().default(false).describe("If true, simulate only and return estimates"),
    maxPerTx: z.number().int().min(1).max(10).optional().default(5)
      .describe("Max account closes per transaction. More = cheaper but riskier."),
  },
  returns: {
    dryRun: boolean,
    totalAccounts: number,
    totalReclaimableSol: number,
    transactions: Array<{ signature?, accounts: string[], reclaimedSol: number, status: string }>,
    totalReclaimedSol: number,
    totalFeesSol: number,
    netReclaimedSol: number,
  }
}
```

### Group 3: SCAN Tools (read-only but compute-intensive, session not required)

#### `scan_empty_accounts`
```typescript
{
  name: "scan_empty_accounts",
  description: "Scan wallet for empty/dust token accounts that can be closed to reclaim rent SOL",
  inputSchema: {
    wallet: z.string().optional(),
    includeNonZero: z.boolean().optional().default(false)
      .describe("Include accounts with tiny dust balances (< $0.01)"),
  },
  returns: {
    wallet: string,
    emptyAccounts: Array<{
      tokenAccount: string,
      mint: string,
      symbol: string | null,
      balance: number,
      balanceUsd: number | null,
      rentLamports: string,
      rentSol: number,
    }>,
    totalReclaimableSol: number,
    totalReclaimableUsd: number | null,
    totalAccounts: number,
  }
}
```

#### `scan_all_wallets`
```typescript
{
  name: "scan_all_wallets",
  description: "Scan ALL AI-accessible wallets for reclaimable rent. Portfolio-level rent audit.",
  inputSchema: {
    includeNonZero: z.boolean().optional().default(false),
  },
  returns: {
    wallets: Array<{
      label: string,
      pubkey: string,
      emptyAccountCount: number,
      reclaimableSol: number,
    }>,
    grandTotalReclaimableSol: number,
    grandTotalReclaimableUsd: number | null,
    grandTotalEmptyAccounts: number,
  }
}
```

#### `estimate_portfolio_value`
```typescript
{
  name: "estimate_portfolio_value",
  description: "Full portfolio valuation across all wallets: SOL + tokens + reclaimable rent",
  inputSchema: {},
  returns: {
    wallets: Array<{
      label: string,
      solBalance: number,
      tokenValueUsd: number,
      reclaimableRentSol: number,
      totalValueUsd: number,
    }>,
    portfolioTotalUsd: number,
    totalReclaimableRentSol: number,
  }
}
```

### Group 4: ADMIN Tools (control plane, no session required for reads)

#### `get_wallet_permissions`
```typescript
{
  name: "get_wallet_permissions",
  description: "Get AI permission settings for a wallet",
  inputSchema: {
    wallet: z.string(),
  },
  returns: { label, pubkey, aiAccess, spendLimitPerTx, spendLimitPerSession, rateLimit, requireConfirmation, allowlist }
}
```

#### `get_session_status`
```typescript
{
  name: "get_session_status",
  description: "Check if session is active, remaining time, and session spend totals",
  inputSchema: {},
  returns: { isActive: boolean, remainingMinutes: number | null, sessionSpend: { totalSol: number, txCount: number } }
}
```

#### `get_audit_log`
```typescript
{
  name: "get_audit_log",
  description: "Query audit log with filters. AI can review its own action history.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().default(20),
    wallet: z.string().optional().describe("Filter by wallet"),
    eventType: z.string().optional().describe("Filter by event type prefix, e.g. 'transfer'"),
    actor: z.enum(["user", "ai", "all"]).optional().default("all"),
    since: z.string().optional().describe("ISO 8601 timestamp, return events after this time"),
  },
  returns: { events: Array<{ id, timestamp, eventType, wallet, actor, correlationId, payload }>, total: number }
}
```

#### `get_spend_summary`
```typescript
{
  name: "get_spend_summary",
  description: "Get AI spending summary for current session: totals per wallet, remaining limits",
  inputSchema: {},
  returns: {
    sessionStart: string,
    wallets: Array<{
      label: string,
      spent: number,
      limitPerTx: number,
      limitPerSession: number,
      remaining: number,
      txCount: number,
    }>,
    totalSpent: number,
  }
}
```

---

## 2. Permission Model

### 2.1 Three-Layer Permission Architecture

```
Layer 1: Tool Allowlist (--allow flag)
  └── Which MCP tools are exposed at all
  └── Set at server start: solblade mcp serve --allow "balance,wallets,scan,send_sol"
  └── Cannot be changed without restarting server

Layer 2: Wallet AI Access Level (per-wallet DB field)
  └── none:     Wallet invisible to all MCP tools
  └── read:     Balance, history, scan tools work. Write tools rejected.
  └── transfer: Full access subject to spend limits + confirmation gates

Layer 3: Spend Controls (per-wallet DB fields)
  └── spend_limit_per_tx:      Max SOL value per transaction (0 = unlimited)
  └── spend_limit_per_session:  Max SOL value per session (0 = unlimited)
  └── rate_limit:               Max transactions per minute
  └── require_confirmation:     Boolean — must user approve each write?
  └── allowlist:                JSON array of allowed destination addresses (empty = any)
```

### 2.2 Tool → Permission Mapping

```
Tool                      │ Min Access │ Session │ Spend Check │ Confirm Gate
──────────────────────────┼────────────┼─────────┼─────────────┼─────────────
get_balance               │ read       │ no      │ no          │ no
get_all_balances          │ read       │ no      │ no          │ no
get_token_balances        │ read       │ no      │ no          │ no
list_wallets              │ read       │ no      │ no          │ no
get_token_price           │ (none)     │ no      │ no          │ no
get_swap_quote            │ read       │ no      │ no          │ no
get_transaction_history   │ read       │ no      │ no          │ no
get_account_info          │ (none)     │ no      │ no          │ no
scan_empty_accounts       │ read       │ no      │ no          │ no
scan_all_wallets          │ read       │ no      │ no          │ no
estimate_portfolio_value  │ read       │ no      │ no          │ no
get_wallet_permissions    │ read       │ no      │ no          │ no
get_session_status        │ (none)     │ no      │ no          │ no
get_audit_log             │ read       │ no      │ no          │ no
get_spend_summary         │ read       │ no      │ no          │ no
send_sol                  │ transfer   │ yes     │ yes         │ if enabled
send_token                │ transfer   │ yes     │ yes         │ if enabled
execute_swap              │ transfer   │ yes     │ yes         │ if enabled
close_token_account       │ transfer   │ yes     │ no*         │ if enabled
close_token_accounts_bulk │ transfer   │ yes     │ no*         │ if enabled
```

*Closing accounts reclaims SOL, so no outbound spend — but still requires transfer access because it modifies on-chain state.

### 2.3 CLI UX for Setting Permissions

```bash
# Set AI access level
solblade wallet ai-access <wallet> --level read|transfer|none

# Set spend limits (in SOL)
solblade wallet set-limit <wallet> --per-tx 1.0 --per-session 10.0

# Set rate limit
solblade wallet set-limit <wallet> --rate 10   # 10 tx/min

# Toggle confirmation requirement
solblade wallet set-confirm <wallet> --on|--off

# Set destination allowlist
solblade wallet set-allowlist <wallet> --add <pubkey>
solblade wallet set-allowlist <wallet> --remove <pubkey>
solblade wallet set-allowlist <wallet> --clear

# Quick preset: "demo mode" — read-only on all wallets
solblade wallet ai-access --all --level read

# Quick preset: "agent mode" — transfer on default, 1 SOL/tx, 5 SOL/session
solblade wallet ai-access default --level transfer --per-tx 1 --per-session 5 --confirm off
```

### 2.4 Tool Allowlist Groups (--allow flag)

```
Group Name   │ Tools Included
─────────────┼──────────────────────────────────────────
balance      │ get_balance, get_all_balances, get_token_balances
wallets      │ list_wallets, get_wallet_permissions
price        │ get_token_price
swap         │ get_swap_quote, execute_swap
transfer     │ send_sol, send_token
scan         │ scan_empty_accounts, scan_all_wallets, estimate_portfolio_value
cleanup      │ close_token_account, close_token_accounts_bulk
history      │ get_transaction_history, get_account_info
log          │ get_audit_log, get_spend_summary
admin        │ get_session_status, get_wallet_permissions, get_spend_summary
read         │ (all read-only tools)
write        │ (all write tools)
*            │ (everything)
```

Usage: `solblade mcp serve --allow "read,cleanup"` — exposes all read tools + rent reclaim tools.

---

## 3. Confirmation Flow

### 3.1 The Problem

MCP stdio transport is one-directional for tool calls: the AI sends a request, the server returns a result. There's no built-in "pause and ask the user" in MCP 1.x. The MCP spec does include **sampling** (server→client requests), but this is for asking the LLM, not the human.

### 3.2 Solution: Two-Phase Commit Pattern

When `require_confirmation == true` on a wallet, write tools use a **prepare → confirm** pattern:

**Phase 1: Prepare** — The write tool returns a `pending_action` instead of executing:

```json
{
  "status": "requires_confirmation",
  "actionId": "act_a1b2c3d4",
  "summary": "Send 2.5 SOL from 'treasury' to 9xQe...4kPm",
  "details": {
    "from": "treasury",
    "to": "9xQeR7...4kPm",
    "amountSol": 2.5,
    "estimatedFeesSol": 0.000055,
    "usdValue": 375.00
  },
  "expiresAt": "2026-03-28T12:05:00Z",
  "confirmTool": "confirm_action"
}
```

**Phase 2: Confirm** — A separate `confirm_action` tool executes or cancels:

```typescript
{
  name: "confirm_action",
  description: "Execute or cancel a pending action that requires user confirmation",
  inputSchema: {
    actionId: z.string().describe("The action ID from the prepare step"),
    approved: z.boolean().describe("true to execute, false to cancel"),
  },
  returns: { /* same as the original write tool's return */ }
}
```

**How this works with Claude:** When Claude gets the `requires_confirmation` response, it presents the details to the user in natural language and asks "Should I proceed?" The user says yes/no, Claude calls `confirm_action`. This is natural conversational flow — no special MCP extensions needed.

**Pending action storage:** In-memory map with 5-minute TTL. Pending actions store the fully-built (but unsigned) transaction so execution is instant on confirmation.

```typescript
// Internal: not exposed via MCP
interface PendingAction {
  id: string;                    // act_ + 8 random chars
  toolName: string;              // which tool created this
  walletId: string;
  summary: string;
  details: Record<string, any>;
  transaction: VersionedTransaction | Transaction;  // pre-built, unsigned
  createdAt: number;
  expiresAt: number;             // createdAt + 5min
}

const pendingActions = new Map<string, PendingAction>();
```

### 3.3 When Confirmation is Skipped

If `require_confirmation == false` on the wallet AND the transaction passes all spend limit checks, the write tool executes immediately and returns the result. This enables fully autonomous agent operation within safe bounds.

### 3.4 Decision Matrix

```
require_confirmation │ Within Limits │ Behavior
─────────────────────┼───────────────┼──────────────────────────
true                 │ yes           │ Return pending_action → wait for confirm_action
true                 │ no            │ Reject immediately with limit details
false                │ yes           │ Execute immediately, return result
false                │ no            │ Reject immediately with limit details
```

---

## 4. Multi-Wallet Orchestration

### 4.1 How Claude Manages Multiple Wallets

All tools accept an optional `wallet` parameter. Claude can:
- Query balances across all wallets with `get_all_balances`
- Scan all wallets for rent with `scan_all_wallets`
- Send from any wallet with transfer access
- Use `list_wallets` with group/tag filters to understand the wallet topology

### 4.2 Wallet Groups as Organizational Primitives

Users organize wallets with labels, groups, and tags:
```bash
solblade wallet label hot-1 --group "trading" --tag "dex,jupiter"
solblade wallet label cold-1 --group "storage" --tag "long-term"
solblade wallet label ops-1 --group "operations" --tag "rent-reclaim,dust"
```

Claude can then reason: "The user has 3 trading wallets and 2 storage wallets. I'll sweep dust from trading wallets to ops-1."

### 4.3 Portfolio-Level Tools

`estimate_portfolio_value` is the fleet management overview — it returns SOL balances, token values, and reclaimable rent across all wallets in a single call. This is what Claude uses to give "here's your portfolio" summaries.

### 4.4 Sweep and Consolidation Patterns

Rather than building a monolithic "sweep" tool, Claude composes atomic tools:

```
1. scan_all_wallets()                    → find rent to reclaim
2. close_token_accounts_bulk(wallet: X)  → reclaim rent per wallet
3. get_all_balances()                    → see updated balances
4. send_sol(from: X, to: treasury, amount: ...) → consolidate
```

This composability is a feature — it means the audit trail shows each discrete action, and spend limits apply per-operation. A hackathon judge can see Claude reasoning through the steps.

---

## 5. Rent Reclaim Engine (Killer Demo)

### 5.1 Why This Wins

Every Solana user has dead token accounts from failed mints, closed positions, airdrop dust. Each account locks ~0.002 SOL in rent. Power users easily have 50-200 dead accounts = 0.1-0.4 SOL locked up. This is money people don't know they have, and Solblade's AI agent finds it and gets it back.

### 5.2 Technical Implementation

#### Scanning (`scan_empty_accounts`)

```typescript
async function scanEmptyAccounts(walletPubkey: PublicKey, includeNonZero: boolean) {
  // 1. Fetch ALL token accounts for wallet
  const accounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
    programId: TOKEN_PROGRAM_ID,
  });

  // 2. Also check Token-2022 program
  const accounts2022 = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
    programId: TOKEN_2022_PROGRAM_ID,
  });

  // 3. Filter to closeable accounts
  const closeable = [...accounts.value, ...accounts2022.value].filter(acc => {
    const parsed = acc.account.data.parsed.info;
    const balance = BigInt(parsed.tokenAmount.amount);
    if (balance === 0n) return true;
    if (includeNonZero) {
      // Include dust accounts worth < $0.01
      // Lookup price, calculate USD value
      return usdValue < 0.01;
    }
    return false;
  });

  // 4. Calculate rent per account
  // Standard token account = 165 bytes → ~0.00203928 SOL rent-exempt minimum
  return closeable.map(acc => ({
    tokenAccount: acc.pubkey.toBase58(),
    mint: acc.account.data.parsed.info.mint,
    balance: acc.account.data.parsed.info.tokenAmount.uiAmount,
    rentLamports: acc.account.lamports.toString(),
    rentSol: lamportsToSol(BigInt(acc.account.lamports)),
  }));
}
```

#### Bulk Close (`close_token_accounts_bulk`)

```typescript
async function closeAccountsBulk(
  wallet: Keypair,
  accounts: string[],
  maxPerTx: number,
  dryRun: boolean,
) {
  // 1. Batch accounts into groups of maxPerTx
  const batches = chunk(accounts, maxPerTx);

  // 2. For each batch, build a transaction with multiple closeAccount instructions
  const results = [];
  for (const batch of batches) {
    const tx = new Transaction();

    // Add compute budget (estimate ~30k CU per close)
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({
      units: batch.length * 35_000,
    }));

    for (const accountPubkey of batch) {
      tx.add(createCloseAccountInstruction(
        new PublicKey(accountPubkey),  // account to close
        wallet.publicKey,              // destination (rent goes here)
        wallet.publicKey,              // authority
      ));
    }

    if (dryRun) {
      // Simulate only
      const sim = await connection.simulateTransaction(tx);
      results.push({ accounts: batch, simulated: true, error: sim.value.err });
    } else {
      // Sign, send, confirm
      const sig = await sendRawWithRetry(tx.serialize());
      await confirmTransaction(sig);
      results.push({ signature: sig, accounts: batch, status: "confirmed" });
    }
  }

  return results;
}
```

#### Key Design Decisions

- **Max 10 closes per transaction**: Solana tx size limit is 1232 bytes. Each closeAccount instruction is ~35 bytes. With overhead, 10 fits comfortably. Default to 5 for safety.
- **Sequential batches, not parallel**: Avoids nonce/blockhash conflicts. Slower but more reliable. A batch of 50 accounts = 10 transactions ≈ 30 seconds.
- **Dry run first**: Always offer `dryRun: true` so Claude can show the user what WILL happen before doing it. This is critical for the demo.
- **Token-2022 support**: Check both TOKEN_PROGRAM_ID and TOKEN_2022_PROGRAM_ID. Many newer tokens use 2022.

### 5.3 Demo-Optimized Output

The `scan_empty_accounts` return includes `symbol` resolution where possible (via Jupiter token list or on-chain metadata) so Claude can say "You have 47 empty accounts from tokens like BONK, WIF, and BOME that are locking up 0.096 SOL ($14.40)" instead of showing raw mint addresses.

---

## 6. Audit & Compliance

### 6.1 What Gets Logged

Every MCP tool call generates audit events. The existing tamper-evident chain (SHA-256 linked hashes) is extended:

```
Event Type                    │ Trigger                          │ Payload
──────────────────────────────┼──────────────────────────────────┼──────────────────
mcp.tool.called               │ Any tool invocation              │ { tool, args, requestId }
mcp.tool.completed            │ Tool returns successfully        │ { tool, requestId, resultSummary }
mcp.tool.rejected             │ Permission/limit denied          │ { tool, reason, wallet }
mcp.action.pending            │ Confirmation required            │ { actionId, tool, summary }
mcp.action.confirmed          │ User approved pending action     │ { actionId }
mcp.action.cancelled          │ User cancelled pending action    │ { actionId }
mcp.action.expired            │ Pending action TTL exceeded      │ { actionId }
transfer.requested            │ (existing) send_sol/send_token   │ { from, to, amount, token }
transfer.simulated            │ (existing) simulation pass       │ { computeUnits }
transfer.submitted            │ (existing) tx sent               │ { signature }
transfer.confirmed            │ (existing) tx confirmed          │ { signature, slot }
transfer.failed               │ (existing) tx failed             │ { error }
swap.requested                │ execute_swap called              │ { input, output, amount }
swap.confirmed                │ swap tx confirmed                │ { signature, outputAmount }
cleanup.scanned               │ scan_empty_accounts              │ { wallet, accountCount, reclaimable }
cleanup.closed                │ close_token_account(s)           │ { accounts, reclaimedSol }
session.spend.updated         │ After any write tool             │ { wallet, sessionTotal, limit }
```

### 6.2 Actor Field

All events include `actor: "ai" | "user" | "system"`. MCP-originated events always set `actor: "ai"`. This lets users query "show me everything Claude did."

### 6.3 Correlation IDs

Each MCP tool call generates a correlation ID (UUID v4). If a tool call triggers multiple events (e.g., `send_sol` → requested → simulated → submitted → confirmed), they all share the same correlation ID. This enables tracing a single AI action through its full lifecycle.

### 6.4 AI Self-Review

Claude can call `get_audit_log` with `actor: "ai"` to review its own history. This enables patterns like:

- "What did I do in the last session?" → `get_audit_log({ actor: "ai", limit: 50 })`
- "How much have I spent today?" → `get_spend_summary()`
- "Did my last swap succeed?" → `get_audit_log({ eventType: "swap", limit: 1 })`

### 6.5 Tamper Evidence

The existing hash chain is preserved. Each event's `hash` = SHA-256(previousHash + timestamp + eventType + payload). This means if any event is modified or deleted, the chain breaks. The `get_audit_log` tool could optionally include a `verifyChain: boolean` parameter that checks integrity.

---

## 7. Security Boundaries

### 7.1 NEVER Exposed via MCP (Hard-Coded Denials)

| Capability | Why |
|---|---|
| Export private keys | Game over if leaked. No legitimate AI use case. |
| Export seed phrases | Same as above. |
| Read raw keystore files | Encrypted blobs are still attack surface. |
| Change wallet passwords | Session hijacking vector. |
| Modify AI access levels | AI must not be able to escalate its own permissions. |
| Modify spend limits | AI must not be able to raise its own limits. |
| Delete/archive wallets | Destructive, irreversible. |
| Change RPC endpoints | Could redirect to malicious RPC. |
| Access session key material | The derived key is the master secret. |
| Create/import wallets | Key generation must be user-initiated. |

### 7.2 Defense in Depth

```
┌─────────────────────────────────────────────────────┐
│  MCP Client (Claude)                                │
├─────────────────────────────────────────────────────┤
│  Layer 1: Tool Allowlist (--allow flag)             │ ← server startup
│  ↓ tool exists and is allowed?                      │
├─────────────────────────────────────────────────────┤
│  Layer 2: Wallet AI Access Check                    │ ← per-wallet DB field
│  ↓ wallet.ai_access >= required level?              │
├─────────────────────────────────────────────────────┤
│  Layer 3: Session Check                             │ ← is session active?
│  ↓ write tools only — session must be unlocked      │
├─────────────────────────────────────────────────────┤
│  Layer 4: Spend Limit Check                         │ ← per-wallet DB fields
│  ↓ amount <= per_tx limit? session_total <= limit?  │
├─────────────────────────────────────────────────────┤
│  Layer 5: Rate Limit Check                          │ ← sliding window
│  ↓ tx count this minute < rate_limit?               │
├─────────────────────────────────────────────────────┤
│  Layer 6: Allowlist Check                           │ ← destination address
│  ↓ destination in wallet's allowlist? (if set)      │
├─────────────────────────────────────────────────────┤
│  Layer 7: Confirmation Gate                         │ ← require_confirmation
│  ↓ if true → return pending_action, wait for confirm│
├─────────────────────────────────────────────────────┤
│  Layer 8: Transaction Simulation                    │ ← Solana RPC
│  ↓ simulate before signing, check for errors        │
├─────────────────────────────────────────────────────┤
│  Layer 9: Sign + Submit + Confirm                   │
│  ↓ full audit trail with correlation ID             │
├─────────────────────────────────────────────────────┤
│  Layer 10: Audit Event Chain                        │ ← tamper-evident log
└─────────────────────────────────────────────────────┘
```

### 7.3 Session Unlock Design for MCP

The session must be unlocked BEFORE starting the MCP server, or via environment variable (`SOLBLADE_PASSWORD`). The MCP server itself cannot prompt for passwords — there's no stdin available (it's used by MCP protocol).

Recommended flow:
```bash
# Option A: Unlock first, then serve
solblade unlock
solblade mcp serve --allow "*"

# Option B: Environment variable (for CI/automation)
SOLBLADE_PASSWORD=... solblade mcp serve --allow "*"

# Option C: Auto-unlock on serve with --password flag (stored nowhere)
solblade mcp serve --allow "*" --password "..."
```

The session TTL still applies. If the session expires mid-conversation, write tools return `{ error: "session_expired", message: "Session has expired. Ask the user to run 'solblade unlock'." }`.

---

## 8. Implementation Approach

### 8.1 File Changes

```
src/core/mcp.ts              ← Major rewrite: all tool handlers, permission checks, pending actions
src/core/database.ts          ← Add: session spend tracking, new event types, query helpers
src/core/permissions.ts       ← NEW: centralized permission checking logic
src/core/pending-actions.ts   ← NEW: pending action store with TTL
src/core/rent-scanner.ts      ← NEW: token account scanning and bulk close logic
src/commands/mcp.ts           ← Extend: new --allow groups
src/commands/wallet.ts        ← NEW or extend: ai-access, set-limit, set-confirm, set-allowlist commands
```

### 8.2 Implementation Order

```
Phase 1 (DONE): Read-only tools
Phase 2a:       Permission infrastructure (permissions.ts, wallet CLI commands)
Phase 2b:       Confirmation gate (pending-actions.ts, confirm_action tool)
Phase 2c:       Write tools (send_sol, send_token, execute_swap)
Phase 3a:       Rent scanner (scan_empty_accounts, scan_all_wallets)
Phase 3b:       Bulk close (close_token_account, close_token_accounts_bulk)
Phase 3c:       Portfolio tools (estimate_portfolio_value, get_spend_summary)
Phase 4:        Polish (get_transaction_history, get_account_info, audit enhancements)
```

### 8.3 Session Spend Tracking

Add an in-memory map (reset on session lock/expire) to track per-wallet spend:

```typescript
// In permissions.ts
const sessionSpend = new Map<string, { totalLamports: bigint; txCount: number }>();

function checkSpendLimit(walletId: string, amountLamports: bigint, wallet: WalletRow): SpendCheckResult {
  const current = sessionSpend.get(walletId) ?? { totalLamports: 0n, txCount: 0 };

  if (wallet.spend_limit_per_tx > 0) {
    const limitLamports = solToLamports(wallet.spend_limit_per_tx);
    if (amountLamports > limitLamports) {
      return { allowed: false, reason: `Exceeds per-tx limit of ${wallet.spend_limit_per_tx} SOL` };
    }
  }

  if (wallet.spend_limit_per_session > 0) {
    const limitLamports = solToLamports(wallet.spend_limit_per_session);
    if (current.totalLamports + amountLamports > limitLamports) {
      return { allowed: false, reason: `Would exceed session limit of ${wallet.spend_limit_per_session} SOL (spent: ${lamportsToSol(current.totalLamports)})` };
    }
  }

  return { allowed: true };
}

function recordSpend(walletId: string, amountLamports: bigint): void {
  const current = sessionSpend.get(walletId) ?? { totalLamports: 0n, txCount: 0 };
  sessionSpend.set(walletId, {
    totalLamports: current.totalLamports + amountLamports,
    txCount: current.txCount + 1,
  });
}
```

### 8.4 Rate Limiting

Sliding window per wallet, in-memory:

```typescript
const txTimestamps = new Map<string, number[]>();  // walletId → timestamps

function checkRateLimit(walletId: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const timestamps = (txTimestamps.get(walletId) ?? []).filter(t => now - t < 60_000);
  txTimestamps.set(walletId, timestamps);
  return timestamps.length < limitPerMinute;
}
```

---

## 9. Demo Story (3 Minutes)

### Setup (shown before demo starts)
- 3 wallets pre-created: "treasury" (5 SOL), "trading" (2 SOL + various tokens), "dust" (0.5 SOL + 40 dead token accounts)
- AI access configured: all wallets on `read`, "dust" on `transfer` with 0.5 SOL/tx limit
- MCP server running: `solblade mcp serve --allow "*"`

### Act 1: Discovery (60 seconds)

**Claude prompt:** "What's in my Solana wallets?"

Claude calls `get_all_balances` → `get_token_balances` for each → `estimate_portfolio_value`.

**Claude responds:** "You have 3 wallets totaling 7.5 SOL ($1,125). Your 'trading' wallet has 12 token positions worth ~$340. But here's something interesting — let me check for reclaimable rent..."

Claude calls `scan_all_wallets`.

**Claude responds:** "You have 47 empty token accounts across your wallets locking up 0.096 SOL ($14.40). Your 'dust' wallet alone has 40 dead accounts from old memecoins. Want me to reclaim that rent?"

### Act 2: Reclaim (60 seconds)

**User:** "Yes, clean up the dust wallet."

Claude calls `close_token_accounts_bulk({ wallet: "dust", dryRun: true })`.

**Claude responds:** "Dry run complete. I can close 40 accounts in 8 transactions, reclaiming 0.081 SOL ($12.15) after fees. Proceeding..."

Claude calls `close_token_accounts_bulk({ wallet: "dust", dryRun: false, maxPerTx: 5 })`.

**Claude responds:** "Done! Closed 40 accounts in 8 transactions. Reclaimed 0.081 SOL. Your dust wallet now has 0.581 SOL."

*The audience sees real transactions hitting Solana in real-time. This is the "wow" moment.*

### Act 3: Guarded Transfer (45 seconds)

**User:** "Send 0.3 SOL from dust to my friend at 9xQe...4kPm."

Claude calls `send_sol({ from: "dust", to: "9xQe...4kPm", amount: 0.3 })`.

The tool returns `requires_confirmation` (because require_confirmation is on).

**Claude responds:** "I've prepared a transfer of 0.3 SOL ($45) from 'dust' to 9xQe...4kPm. This is within your 0.5 SOL per-transaction limit. Shall I confirm?"

**User:** "Yes."

Claude calls `confirm_action({ actionId: "act_...", approved: true })`.

**Claude responds:** "Sent! Transaction confirmed: [explorer link]. You have 0.281 SOL remaining in dust."

### Act 4: Safety Demo (15 seconds)

**User:** "Now send 10 SOL from treasury."

Claude calls `send_sol({ from: "treasury", to: "...", amount: 10 })`.

Tool rejects: `ai_access is 'read' on treasury`.

**Claude responds:** "I can't do that — your treasury wallet is set to read-only for AI access. You'd need to upgrade it to 'transfer' access with `solblade wallet ai-access treasury --level transfer`. This is by design — your high-value wallets stay protected."

### Closing Line
"Solblade gives AI agents a Solana wallet with guardrails. Scoped permissions, spend limits, confirmation gates, tamper-evident audit logs. The CLI you already use, now with an MCP server that makes Claude your portfolio manager — without giving away the keys."

---

## 10. Competitive Positioning

```
Feature                   │ Latinum │ MCPay │ Mercantill │ Solblade
──────────────────────────┼─────────┼───────┼────────────┼─────────
CLI-native                │ ✗       │ ✗     │ ✗          │ ✓
MCP protocol              │ ✓       │ ✓     │ ✗          │ ✓
Per-wallet permissions    │ ?       │ ✗     │ ✓          │ ✓
Spend limits              │ ?       │ ✗     │ ✓          │ ✓
Confirmation gates        │ ✗       │ ✗     │ ?          │ ✓
Rent reclaim engine       │ ✗       │ ✗     │ ✗          │ ✓
Tamper-evident audit      │ ✗       │ ✗     │ ✓          │ ✓
Multi-wallet orchestration│ ✗       │ ✗     │ ?          │ ✓
Encrypted local keystore  │ ?       │ ✗     │ ?          │ ✓
Token swaps via MCP       │ ✗       │ ✗     │ ✗          │ ✓
```

The unique pitch: **Nobody else gives AI agents a full CLI wallet with scoped permissions.** Latinum is middleware (you still need a wallet). MCPay is payment infra (not a wallet). Mercantill is enterprise (not developer-facing). Solblade is the wallet itself, with MCP built in.
