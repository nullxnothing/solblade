<p align="center">
  <img src="banner.png" alt="Solblade" width="700" />
</p>

<p align="center">
  <strong>AI-native Solana wallet CLI with scoped MCP server</strong><br/>
  Your keys. Their hands. Your rules.
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &bull;
  <a href="#mcp-server">MCP Server</a> &bull;
  <a href="#security-model">Security</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="#architecture">Architecture</a>
</p>

---

Solblade is a Solana wallet that runs in your terminal and exposes a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server so AI agents like Claude can manage your wallets — with granular, per-wallet permission scoping you control.

No browser extensions. No custodial APIs. Just a CLI with an encrypted local keystore and an MCP interface that gives AI exactly the access you choose: read-only portfolio views, spend-limited transfers, or full autonomy within guardrails.

## Why Solblade

**The problem:** AI agents need wallet access to be useful on-chain, but giving an AI your private key is insane, and read-only access is useless for real work.

**The solution:** Solblade sits between your keys and the AI. You set per-wallet access levels (`none`, `read`, `transfer`), per-transaction spend limits, session budgets, rate limits, and destination allowlists. The AI operates within those bounds. Every action is logged in a tamper-evident audit chain. You can revoke access with one command.

**What makes this different:**

- **CLI-native MCP server** — no web app, no browser extension, just `solblade mcp serve`
- **Per-wallet AI permissions** — each wallet has its own access level and spend limits
- **Confirmation gates** — require human approval for transfers, or let the agent auto-execute under limits
- **Rent reclaim engine** — AI scans for dead token accounts and reclaims locked SOL in bulk
- **Tamper-evident audit log** — SHA-256 chained event log of every AI action
- **Encrypted local keystore** — AES-256-GCM with PBKDF2 key derivation, keys never leave your machine

## Quickstart

```bash
# Install
bun install -g solblade

# Initialize — creates keystore, first wallet, sets RPC
solblade init

# Check your balance
solblade balance

# Start the MCP server (read-only)
solblade mcp serve --allow "read"
```

### Connect to Claude Desktop

Add to your Claude Desktop MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "solblade": {
      "command": "solblade",
      "args": ["mcp", "serve", "--allow", "*"]
    }
  }
}
```

Then ask Claude: *"What's in my Solana wallets?"*

## MCP Server

The MCP server exposes Solana wallet operations as tools that any MCP-compatible AI client can call.

```bash
# Read-only — balances, prices, portfolio overview
solblade mcp serve --allow "read"

# Read + rent reclaim — let AI clean up dead accounts
solblade mcp serve --allow "read,scan,cleanup"

# Full access — transfers, swaps, everything (within wallet limits)
solblade mcp serve --allow "*"
```

### Tool Groups

| Group | Tools | Description |
|-------|-------|-------------|
| `balance` | `get_balance`, `get_all_balances`, `get_token_balances` | SOL and token balance queries |
| `wallets` | `list_wallets`, `get_wallet_permissions` | Wallet metadata and AI access levels |
| `price` | `get_token_price` | USD prices via Jupiter/Birdeye |
| `swap` | `get_swap_quote`, `execute_swap` | Jupiter DEX quotes and execution |
| `transfer` | `send_sol`, `send_token` | SOL and SPL token transfers |
| `scan` | `scan_empty_accounts`, `scan_all_wallets`, `estimate_portfolio_value` | Rent reclaim scanning, portfolio valuation |
| `cleanup` | `close_token_account`, `close_token_accounts_bulk` | Close dead token accounts, reclaim rent |
| `history` | `get_transaction_history`, `get_account_info` | On-chain transaction and account data |
| `log` | `get_audit_log`, `get_spend_summary` | AI action history and spend tracking |
| `admin` | `get_session_status` | Session and permission introspection |

### Permission Scoping

Every wallet has independent AI access controls:

```bash
# Give AI read-only access to a wallet
solblade wallet ai-access treasury --level read

# Give AI transfer access with limits
solblade wallet ai-access trading --level transfer --per-tx 1 --per-session 5

# Require human confirmation for each transfer
solblade wallet set-confirm trading --on

# Restrict destinations
solblade wallet set-allowlist trading --add <trusted-pubkey>
```

### Confirmation Flow

When a wallet has `require_confirmation` enabled, write tools return a pending action instead of executing. The AI presents the details to you and waits for approval:

```
Claude: "I'd like to send 0.5 SOL from 'trading' to 9xQe...4kPm ($75.00).
         This is within your 1 SOL per-transaction limit. Approve?"
You:    "Yes"
Claude: "Done — tx confirmed: 5Uj8...explorer link"
```

## Security Model

```
┌─ Tool Allowlist ────────── which tools are exposed at all
├─ Wallet AI Access ──────── none / read / transfer per wallet
├─ Session Gate ──────────── password-derived key, configurable TTL
├─ Spend Limits ──────────── per-tx and per-session caps in SOL
├─ Rate Limits ───────────── max transactions per minute
├─ Destination Allowlist ─── restrict where funds can go
├─ Confirmation Gate ─────── human approval before execution
├─ Transaction Simulation ── Solana RPC simulation before signing
└─ Tamper-Evident Audit ──── SHA-256 chained event log
```

**Never exposed via MCP:** private key export, seed phrases, keystore files, password/session material, permission escalation, wallet creation/deletion, RPC config changes.

## Commands

### Wallet Management
```bash
solblade create [--label name] [--group name]     # Create new wallet
solblade import --key <base58>                     # Import existing key
solblade list [--group name] [--tag name]          # List wallets
solblade label <wallet> --set <name>               # Rename wallet
solblade default <wallet>                          # Set default wallet
solblade remove <wallet>                           # Archive wallet
```

### Transactions
```bash
solblade balance [wallet]                          # SOL balance
solblade balance --all                             # All wallet balances
solblade balance --tokens [wallet]                 # SPL token balances
solblade send <amount> SOL --to <address>          # Send SOL
solblade send <amount> <token> --to <address>      # Send SPL token
solblade swap <amount> <token> --to <token>        # Jupiter swap
```

### Session & Security
```bash
solblade unlock                                    # Start session (enter password)
solblade lock                                      # End session
solblade unlock --status                           # Check session
```

### MCP Server
```bash
solblade mcp serve [--allow <tools>]               # Start MCP stdio server
```

### Audit
```bash
solblade log [--limit N]                           # View audit log
```

## Architecture

- **Runtime:** [Bun](https://bun.sh) — fast JS runtime with native SQLite
- **Encryption:** AES-256-GCM with PBKDF2-SHA256 (600k iterations)
- **Database:** SQLite with WAL mode for concurrent reads
- **MCP:** `@modelcontextprotocol/sdk` v1.28.0 over stdio transport
- **Solana:** `@solana/web3.js` v1.x + `@solana/spl-token` v0.4
- **DEX:** Jupiter V6 API for quotes and swaps
- **Keystore:** `~/.solblade/keys/*.enc` — one encrypted file per wallet

See [`docs/MCP_ARCHITECTURE.md`](docs/MCP_ARCHITECTURE.md) for the full MCP server design including tool schemas, permission model, and implementation plan.

## Development

```bash
# Clone and install
git clone https://github.com/shillshady/solblade.git
cd solblade
bun install

# Run in dev mode
bun run dev

# Build standalone binary
bun run build
```

## License

MIT

---

<p align="center">
  <img src="logo.png" alt="Solblade logo" width="48" />
  <br/>
  Built for the <a href="https://www.colosseum.org/">Colosseum</a> hackathon.
</p>
