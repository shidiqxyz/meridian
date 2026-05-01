# Meridian

**Autonomous Meteora DLMM liquidity management agent for Solana, powered by LLMs.**

Meridian runs continuous screening and management cycles, deploying capital into high-quality Meteora DLMM pools and closing positions based on live PnL, yield, and range data. It learns from every position it closes.

---

## What it does

- **Screens pools** — scans Meteora DLMM pools against configurable thresholds (fee/TVL ratio, organic score, holder count, mcap, bin step) and surfaces high-quality opportunities
- **Manages positions** — monitors, claims fees, and closes LP positions autonomously; decides to STAY, CLOSE, or REDEPLOY based on live data
- **Learns from performance** — studies top LPers in target pools, saves structured lessons, and evolves screening thresholds based on closed position history
- **Discord signals** — optional Discord listener watches LP Army channels for Solana token calls and queues them for screening
- **Telegram chat** — full agent chat via Telegram, plus cycle reports and OOR alerts
- **CLI** — direct tool invocation with JSON output for scripting and debugging

---

## How it works

Meridian runs a **ReAct agent loop** — each cycle the LLM reasons over live data, calls tools, and acts. Two specialized agents run on independent cron schedules:

| Agent | Default interval | Role |
|---|---|---|
| **Screening Agent** | Every 30 min | Pool screening — finds and deploys into the best candidate |
| **Management Agent** | Every 10 min | Position management — evaluates each open position and acts |

**Data sources:**
- `@meteora-ag/dlmm` SDK — on-chain position data, active bin, deploy/close transactions
- Meteora DLMM PnL API — position yield, fee accrual, PnL
- OKX OnchainOS — smart money signals, token risk scoring
- Pool screening API — fee/TVL ratios, volume, organic scores, holder counts
- Jupiter API — token audit, mcap, launchpad, price stats

Agents are powered via **OpenRouter** and can be swapped for any compatible model.

---

## Requirements

- Node.js 18+
- [OpenRouter](https://openrouter.ai) API key
- Solana wallet (base58 private key)
- Solana RPC endpoint ([Helius](https://helius.xyz) recommended)
- Telegram bot token (optional)

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/shidiqxyz/meridian
cd meridian
npm install
```

### 2. Run the setup wizard

```bash
npm run setup
```

The wizard walks you through creating `.env` (API keys, wallet, RPC, Telegram) and `src/core/config/user-config.json` (risk preset, deploy size, thresholds, models). Takes about 2 minutes.

**Or set up manually:**

Create `.env`:

```env
WALLET_PRIVATE_KEY=your_base58_private_key
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
OPENROUTER_API_KEY=sk-or-...
HELIUS_API_KEY=your_helius_key          # for wallet balance lookups
TELEGRAM_BOT_TOKEN=123456:ABC...        # optional — for notifications + chat
TELEGRAM_CHAT_ID=                       # auto-filled on first message
TELEGRAM_ALLOWED_USER_IDS=              # comma-separated user IDs for command control
DRY_RUN=true                            # set false for live trading
```

> Never put your private key or API keys in `user-config.json` — use `.env` only. Both files are gitignored.

Optional encrypted `.env` flow:

```bash
printf "WALLET_PRIVATE_KEY=...\nRPC_URL=...\nOPENROUTER_API_KEY=...\n" > .env.raw
printf "replace-with-a-long-local-key\n" > .envrypt
npm run env:encrypt
rm .env.raw  # delete plaintext after encrypting
```

Meridian loads envrypt-style encrypted values automatically. Keep `.envrypt` local; it is gitignored.

Copy config and edit as needed:

```bash
cp src/core/config/user-config.example.json src/core/config/user-config.json
```

### 3. Run

```bash
npm run dev    # dry run — no on-chain transactions
npm start      # live mode
```

On startup Meridian fetches your wallet balance, open positions, and top pool candidates, then begins autonomous cycles immediately.

---

## File structure

| File | Purpose |
|------|---------|
| `.env` | Secrets only (private key, API keys, RPC) — encrypted or plaintext |
| `.envrypt` | Encryption key for `.env` |
| `src/core/config/user-config.json` | All behavior settings (thresholds, intervals, toggles, models) |

Secrets never go in `user-config.json` — that file contains no credentials and is safe to keep locally unencrypted.

---

## Running modes

### Autonomous agent

```bash
npm start
```

Starts the full autonomous agent with cron-based screening + management cycles and an interactive REPL. The prompt shows a live countdown to the next cycle:

```
[manage: 8m 12s | screen: 24m 3s]
>
```

REPL commands:

| Command | Description |
|---|---|
| `/status` | Wallet balance and open positions |
| `/candidates` | Re-screen and display top pool candidates |
| `/learn` | Study top LPers across all current candidate pools |
| `/learn <pool_address>` | Study top LPers for a specific pool |
| `/thresholds` | Current screening thresholds and performance stats |
| `/evolve` | Trigger threshold evolution from performance data (needs 5+ closed positions) |
| `/stop` | Graceful shutdown |
| `<anything>` | Free-form chat — ask the agent anything, request actions, analyze pools |

### CLI (direct tool invocation)

The `meridian` CLI gives you direct access to every tool with JSON output — useful for scripting, debugging, or piping into other tools.

```bash
npm install -g .   # install globally (once)
meridian <command> [flags]
```

**Positions & PnL**

```bash
meridian positions
meridian pnl <position_address>
meridian wallet-positions --wallet <addr>
```

**Screening**

```bash
meridian candidates --limit 5
meridian pool-detail --pool <addr> [--timeframe 5m]
meridian active-bin --pool <addr>
meridian search-pools --query <name_or_symbol>
meridian study --pool <addr> [--limit 4]
```

**Token research**

```bash
meridian token-info --query <mint_or_symbol>
meridian token-holders --mint <addr> [--limit 20]
meridian token-narrative --mint <addr>
```

**Deploy & manage**

```bash
meridian deploy --pool <addr> --amount <sol> [--bins-below 69] [--bins-above 0] [--strategy bid_ask|spot|curve] [--dry-run]
meridian claim --position <addr>
meridian close --position <addr> [--skip-swap] [--dry-run]
meridian swap --from <mint> --to <mint> --amount <n> [--dry-run]
meridian add-liquidity --position <addr> --pool <addr> [--amount-x <n>] [--amount-y <n>] [--strategy spot]
meridian withdraw-liquidity --position <addr> --pool <addr> [--bps 10000]
```

**Agent cycles**

```bash
meridian screen [--dry-run] [--silent]   # one AI screening cycle
meridian manage [--dry-run] [--silent]   # one AI management cycle
meridian start [--dry-run]               # start autonomous agent with cron jobs
```

**Config**

```bash
meridian config get
meridian config set <key> <value>
```

**Learning & memory**

```bash
meridian lessons
meridian lessons add "your lesson text"
meridian performance [--limit 200]
meridian evolve
meridian pool-memory --pool <addr>
```

**Blacklist**

```bash
meridian blacklist list
meridian blacklist add --mint <addr> --reason "reason"
```

**Discord signals**

```bash
meridian discord-signals
meridian discord-signals clear
```

**Balance**

```bash
meridian balance
```

**Flags**

| Flag | Effect |
|---|---|
| `--dry-run` | Skip all on-chain transactions |
| `--silent` | Suppress Telegram notifications for this run |

---

## Discord listener

The Discord listener watches configured channels (e.g. LP Army) for Solana token calls and queues them as signals for the screener agent.

### Setup

```bash
cd discord-listener
npm install
```

Add to your root `.env`:

```env
DISCORD_USER_TOKEN=your_discord_account_token   # from browser DevTools → Network
DISCORD_GUILD_ID=the_server_id
DISCORD_CHANNEL_IDS=channel1,channel2            # comma-separated
DISCORD_MIN_FEES_SOL=5                           # minimum pool fees to pass pre-check
```

> This uses a selfbot (personal account automation, not a bot token). Use responsibly.

### Run

```bash
cd discord-listener
npm start
```

Or run it in a separate terminal alongside the main agent. Signals are written to `discord-signals.json` and picked up automatically by `/screen` and the screening cycle.

### Signal pipeline

Each incoming token address passes through a pre-check pipeline before being queued:
1. **Dedup** — ignores addresses seen in the last 10 minutes
2. **Blacklist** — rejects blacklisted token mints
3. **Pool resolution** — resolves the address to a Meteora DLMM pool
4. **Rug check** — checks deployer against `deployer-blacklist.json`
5. **Fees check** — rejects pools below `DISCORD_MIN_FEES_SOL`

Signals that pass all checks are queued with status `pending`. The screener picks up pending signals and processes them as priority candidates before running the normal screening cycle.

### Deployer blacklist

Add known rug/farm deployer wallet addresses to `deployer-blacklist.json`:

```json
{
  "_note": "Known farm/rug deployers — add addresses to auto-reject their pools",
  "addresses": [
    "WaLLeTaDDressHere"
  ]
}
```

---

## Telegram

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Add `TELEGRAM_BOT_TOKEN=<token>` to your `.env`
3. Start the agent, then send any message to your bot — it auto-registers your chat ID

For command control in groups, set `TELEGRAM_ALLOWED_USER_IDS=<comma-separated user IDs>`.

### Notifications

Meridian sends notifications automatically for:
- Management cycle reports (reasoning + decisions)
- Screening cycle reports (what it found, whether it deployed)
- OOR alerts when a position leaves range past `outOfRangeWaitMinutes`
- Deploy: pair, amount, position address, tx hash
- Close: pair and PnL

### Telegram commands

Meridian registers commands with Telegram so typing `/` shows a menu. Available commands:

| Command | Action |
|---------|--------|
| `/start` | Welcome message with usage guide + command list |
| `/help` | Full command list |
| `/deploy` | Pick best pool via `pick_best_candidate` → `deploy_position` |
| `/balance` | Check wallet balance (SOL + token balances) |
| `/positions` | List open positions (token pair, USD value, PnL, fees) |
| `/close <n>` | Close position by list index (auto-swaps to SOL) |
| `/set <n> <note>` | Set note on position by list index |
| `/clear` | Clear Telegram REPL session history |
| `/update` | Update bot via git pull + restart |

**Persistent REPL session**: Natural language messages use a persistent `telegramSession` array (like the console REPL's `replSession`). The agent remembers conversation context across messages. Use `/clear` to reset.

**Message formatting**: Uses `sendHTML()` for bold text (Telegram HTML mode, not Markdown).

You can also chat freely via Telegram using the same interface as the REPL.

---

## Config reference

All fields are optional — defaults shown. Edit `src/core/config/user-config.json`.

### Screening

| Field | Default | Description |
|---|---|---|
| `minFeeActiveTvlRatio` | `0.05` | Minimum fee/active-TVL ratio |
| `minTvl` | `10000` | Minimum pool TVL (USD) |
| `maxTvl` | `150000` | Maximum pool TVL (USD) |
| `minVolume` | `500` | Minimum pool volume |
| `minOrganic` | `60` | Minimum organic score (0–100) |
| `minHolders` | `500` | Minimum token holder count |
| `minMcap` | `150000` | Minimum market cap (USD) |
| `maxMcap` | `10000000` | Maximum market cap (USD) |
| `minBinStep` | `80` | Minimum bin step |
| `maxBinStep` | `125` | Maximum bin step |
| `timeframe` | `5m` | Candle timeframe for screening |
| `category` | `trending` | Pool category filter |
| `minTokenFeesSol` | `30` | Minimum all-time fees in SOL |
| `maxBundlersPct` | `30` | Maximum bundler % in top 100 holders |
| `maxTop10Pct` | `60` | Maximum top-10 holder concentration |
| `blockedLaunchpads` | `[]` | Launchpad names to never deploy into |

### Management

| Field | Default | Description |
|---|---|---|
| `deployAmountSol` | `0.5` | Base SOL per new position |
| `positionSizePct` | `0.35` | Fraction of deployable balance to use |
| `maxDeployAmount` | `50` | Maximum SOL cap per position |
| `gasReserve` | `0.2` | Minimum SOL to keep for gas |
| `minSolToOpen` | `0.55` | Minimum wallet SOL before opening |
| `outOfRangeWaitMinutes` | `30` | Minutes OOR before acting |
| `stopLossPct` | `-15` | Close position if price drops by this % |

### Schedule

| Field | Default | Description |
|---|---|---|
| `managementIntervalMin` | `10` | Management cycle frequency (minutes) |
| `screeningIntervalMin` | `30` | Screening cycle frequency (minutes) |

### Models

| Field | Default | Description |
|---|---|---|
| `managementModel` | `qwen/qwen3.5-flash` | LLM for management cycles |
| `screeningModel` | `qwen/qwen3.5-flash` | LLM for screening cycles |
| `generalModel` | `qwen/qwen3.5-flash` | LLM for REPL / chat |

> Override model at runtime: `meridian config set screeningModel anthropic/claude-opus-4-5`

**Model settings:**
- `maxSteps: 12` (agent loop max iterations)
- Timeout: 60s per LLM call
- Retry logic: "Premature close", empty responses → retry with delay

---

## How it learns

### Lessons

After every closed position the agent runs `studyTopLPers` on candidate pools, analyzes on-chain behavior of top performers (hold duration, entry/exit timing, win rates), and saves concrete lessons. Lessons are injected into subsequent agent cycles as part of the system context.

Add a lesson manually:
```bash
meridian lessons add "Never deploy into pump.fun tokens under 2h old"
```

### Threshold evolution

After 5+ positions have been closed, run:
```bash
meridian evolve
```

This analyzes closed position performance (win rate, avg PnL, fee yields) and automatically adjusts screening thresholds in `src/core/config/user-config.json`. Changes take effect immediately.

---

## HiveMind

HiveMind sync uses Agent Meridian by default. Shared lessons, presets, and performance summaries are routed through the configured Agent Meridian API.

**What you get:** shared lessons, strategy presets, and crowd performance context from other Meridian agents.

**What you share:** lessons and closed-position performance. Wallet private keys and balances are never sent.

### Disable

Set `hiveMindEnabled: false` in `src/core/config/user-config.json`.

### Self-hosting

See [meridian-hive](https://github.com/fciaf420/meridian-hive) for the server source.

---

## Using a local model (LM Studio)

```env
LLM_BASE_URL=http://localhost:1234/v1
LLM_API_KEY=lm-studio
LLM_MODEL=your-local-model-name
```

Any OpenAI-compatible endpoint works.

---

## Architecture

```
src/
  index.ts            Main entry: REPL + cron orchestration + Telegram bot polling
  cli.ts              CLI with JSON output for every tool
  core/
    agent/            ReAct loop, prompt building
    config/           Runtime config, envcrypt
    cron/             Cycle scheduling
    logger/           Daily-rotating log files + action audit
    state/            Position registry, lessons, decisions, pool memory, signals
    types/            Shared TypeScript interfaces
    utils/            Number formatting, text sanitization
  services/           Briefing, hivemind, smart-wallets, telegram, token-blacklist
  tools/
    definitions.ts    Tool schemas (OpenAI format)
    executor.ts       Tool dispatch + safety checks
    dlmm.ts           Meteora DLMM SDK wrapper (deploy, close, claim, positions, PnL)
    state-utils.ts     Shared loadJson/saveJson utilities
    screening.ts      Pool discovery from Meteora API
    wallet.ts         SOL/token balances (Helius) + Jupiter swap
    token.ts          Token info/holders/narrative (Jupiter API)
    study.ts          Top LPer study via LPAgent API
    okx.ts            OKX OnchainOS integration
    chart-indicators.ts Technical chart indicators
    agent-meridian.ts Agent Meridian relay client
```

---

## Development

All source is TypeScript. Run type-checking:

```bash
npx tsc --noEmit                 # main project
npx tsc --noEmit -p discord-listener/tsconfig.json   # discord listener
```

Testing with **vitest** (425 tests, ~98% coverage):
```bash
npx vitest run                   # run all tests
npx vitest run --coverage        # with coverage report
```

Type-checking:

```bash
npm run typecheck
```

Scripts run via `npx tsx`:

```bash
npm run setup                    # interactive setup wizard
npm run env:encrypt              # encrypt .env.raw → .env
npm run patch-anchor             # anchor patching utility
```

---

## Disclaimer

This software is provided as-is, with no warranty. Running an autonomous trading agent carries real financial risk — you can lose funds. Always start with `DRY_RUN=true` to verify behavior before going live. Never deploy more capital than you can afford to lose. This is not financial advice.

The authors are not responsible for any losses incurred through use of this software.
