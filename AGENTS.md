# Meridian — AGENTS.md

Autonomous DLMM liquidity provider agent for Meteora pools on Solana.

---

## Architecture Overview

```
src/
  index.ts            Main entry: REPL + cron orchestration + Telegram bot polling
  cli.ts              CLI with JSON output for every tool
  core/
    agent/agent.ts    ReAct loop (OpenRouter/OpenAI-compatible): LLM → tool call → repeat
    agent/prompt.ts   Builds system prompt per agent role (SCREENER / MANAGER / GENERAL)
    config/config.ts  Runtime config from user-config.json + .env; exposes config object
    cron/cron.ts      Cycle scheduling and countdown
    logger/logger.ts  Daily-rotating log files + action audit trail
    state/
      state.ts        Position registry (state.json): tracks bin ranges, OOR timestamps, notes
      lessons.ts      Learning engine: records closed-position perf, derives lessons, evolves thresholds
      pool-memory.ts  Per-pool deploy history + snapshots (pool-memory.json)
      strategy-library.ts  Saved LP strategies (strategy-library.json)
      decision-log.ts Decision audit trail (decision-log.json)
      signal-tracker.ts   Discord signal queue management
      signal-weights.ts   Signal scoring weights
    types/            Shared TypeScript interfaces
    utils/            Number formatting, text sanitization
  services/
    briefing.ts       Daily Telegram briefing (HTML)
    telegram.ts       Telegram bot: polling, notifications (deploy/close/swap/OOR)
    hivemind.ts       Agent Meridian HiveMind sync
    smart-wallets.ts  KOL/alpha wallet tracker (smart-wallets.json)
    token-blacklist.ts Permanent token blacklist (token-blacklist.json)
    dev-blocklist.ts  Developer blacklist
  tools/
    definitions.ts    Tool schemas in OpenAI format (what LLM sees)
    executor.ts       Tool dispatch: name → fn, safety checks, pre/post hooks
    dlmm.ts           Meteora DLMM SDK wrapper (deploy, close, claim, positions, PnL, add/withdraw liquidity)
    screening.ts      Pool discovery from Meteora API
    wallet.ts         SOL/token balances (Helius) + Jupiter swap
    token.ts          Token info/holders/narrative (Jupiter API)
    study.ts          Top LPer study via LPAgent API
    okx.ts            OKX OnchainOS integration
    chart-indicators.ts Technical chart indicators
    agent-meridian.ts Agent Meridian relay client
```

All source is TypeScript. Run `npx tsc --noEmit` to type-check.

---

## Testing

Framework: **vitest** with v8 coverage. 425 tests, ~98% statement coverage.

```
npx vitest run            # Run all tests
npx vitest run --coverage # Run with coverage report
```

**Windows note**: `poolOptions.threads.singleThread: true` in vitest.config.ts is mandatory to avoid EPERM file lock races on state JSON files.

**Test file conventions**:
- `beforeEach`/`afterEach` must clean up all state JSON files the module touches
- Retry file deletion up to 3× for Windows file locks
- Do not import modules under test before `beforeEach` if they have file I/O side effects at module load time
- Use relative paths like `./state.json` (not absolute) — the working directory is set by vitest

**Test files**:
| File | Covers |
|------|--------|
| `test/config.test.ts` | computeDeployAmount, config defaults, reloadScreeningThresholds |
| `test/envcrypt.test.ts` | loadEnv, encryptEnvRaw, decrypt round-trips, .envrypt file handling |
| `test/lessons.test.ts` | evolveThresholds, recordPerformance validation, lesson CRUD |
| `test/pool-memory.test.ts` | recordPoolDeploy, recallForPool, cooldowns (OOR + fee-generating) |
| `test/sanitize.test.ts` | sanitizeText, allowedPattern, null returns, truncation |
| `test/signal-weights.test.ts` | recalculateWeights, getWeightsSummary, corrupt file fallback |
| `test/state.test.ts` | Position lifecycle, exit logic, trailing drop, event trimming |
| `test/strategy-library.test.ts` | Strategy CRUD, default init, active strategy |
| `test/decision-log.test.ts` | Decision CRUD, summary generation |
| `test/signal-tracker.test.ts` | Signal staging and consumption |
| `test/dlmm.test.ts` | Deploy safety checks, cooldown enforcement |
| `test/blacklist.test.ts` | Token blacklist, dev blocklist CRUD |
| `test/state-utils.test.ts` | loadJson/saveJson utility functions |
| `test/agent.test.ts` | getToolsForRole filtering for agent roles |
| `test/agent.test.ts` | getToolsForRole filtering for agent roles |

---

## Agent Roles & Tool Access

Three agent roles filter which tools the LLM can call:

| Role | Purpose | Key Tools |
|------|---------|-----------|
| `SCREENER` | Find and deploy new positions | deploy_position, get_top_candidates, get_token_holders, check_smart_wallets_on_pool |
| `MANAGER` | Manage open positions | close_position, claim_fees, swap_token, get_position_pnl, set_position_note |
| `GENERAL` | Chat / manual commands | All tools |

Sets defined in `src/core/agent/agent.ts`. If you add a tool, also add it to the relevant set(s).

---

## Adding a New Tool

1. **`src/tools/definitions.ts`** — Add OpenAI-format schema object to the `tools` array
2. **`src/tools/executor.ts`** — Add `tool_name: functionImpl` to `toolMap`
3. **`src/core/agent/agent.ts`** — Add tool name to `MANAGER_TOOLS` and/or `SCREENER_TOOLS` if role-restricted
4. If the tool writes on-chain state, add it to `WRITE_TOOLS` in executor.ts for safety checks

---

## Config System

`src/core/config/config.ts` loads `src/core/config/user-config.json` at startup. Runtime mutations go through `update_config` tool (executor.ts) which:
- Updates the live `config` object immediately
- Persists to `src/core/config/user-config.json`
- Restarts cron jobs if intervals changed

**Valid config keys and their sections:**

| Key | Section | Default |
|-----|---------|---------|
| minFeeActiveTvlRatio | screening | 0.05 |
| minTvl / maxTvl | screening | 10k / 150k |
| minVolume | screening | 500 |
| minOrganic | screening | 60 |
| minHolders | screening | 500 |
| minMcap / maxMcap | screening | 150k / 10M |
| minBinStep / maxBinStep | screening | 80 / 125 |
| timeframe | screening | "5m" |
| category | screening | "trending" |
| minTokenFeesSol | screening | 30 |
| maxBundlersPct | screening | 30 |
| maxTop10Pct | screening | 60 |
| blockedLaunchpads | screening | [] |
| deployAmountSol | management | 0.5 |
| maxDeployAmount | risk | 50 |
| maxPositions | risk | 3 |
| gasReserve | management | 0.2 |
| positionSizePct | management | 0.35 |
| minSolToOpen | management | 0.55 |
| outOfRangeWaitMinutes | management | 30 |
| managementIntervalMin | schedule | 10 |
| screeningIntervalMin | schedule | 30 |
| managementModel / screeningModel / generalModel | llm | openrouter/healer-alpha |
| hiveMindEnabled | hivemind | true |

**`computeDeployAmount(walletSol)`** — scales position size with wallet balance (compounding). Formula: `clamp(deployable × positionSizePct, floor=deployAmountSol, ceil=maxDeployAmount)`.

---

## Position Lifecycle

1. **Deploy**: `deploy_position` → executor safety checks → `trackPosition()` in state.ts → Telegram notify
2. **Monitor**: management cron → `getMyPositions()` → `getPositionPnl()` → OOR detection → pool-memory snapshots
3. **Close**: `close_position` → `recordPerformance()` in lessons.ts → auto-swap base token to SOL → Telegram notify
4. **Learn**: `evolveThresholds()` runs on performance data → updates config.screening → persists to `src/core/config/user-config.json`

---

## Screener Safety Checks (executor.ts)

Before `deploy_position` executes:
- `bin_step` must be within `[minBinStep, maxBinStep]`
- Position count must be below `maxPositions` (force-fresh scan, no cache)
- No duplicate pool allowed (same pool_address)
- No duplicate base token allowed (same base_mint in another pool)
- If `amount_x > 0`: strip `amount_y` and `amount_sol` (tokenX-only deploy — no SOL needed)
- SOL balance must cover `amount_y + gasReserve` (skipped for tokenX-only)
- `blockedLaunchpads` enforced in `getTopCandidates()` before LLM sees candidates

---

## bins_below Calculation (SCREENER)

Linear formula based on pool volatility (set in screener prompt, `src/index.ts`):

```
bins_below = round(35 + (volatility / 5) * 34), clamped to [35, 69]
```

- Low volatility (0) → 35 bins
- High volatility (5+) → 69 bins
- Any value in between is valid (continuous, not tiered)

---

## Telegram Commands

Handled directly in `src/index.ts` (bypass LLM). Commands are registered with Telegram via `setMyCommands` so typing `/` shows a menu.

| Command | Action |
|---------|--------|
| `/start` | Welcome message with usage guide |
| `/help` | Full command list |
| `/positions` | List open positions with progress bar |
| `/close <n>` | Close position by list index |
| `/set <n> <note>` | Set note on position by list index |
| `/clear` | Clear Telegram REPL session history |
| `/update` | Update bot via git pull + restart |

**Persistent REPL session**: Natural language messages use a persistent `telegramSession` array (like the console REPL's `replSession`). The agent remembers conversation context across messages. Use `/clear` to reset.

**Session state**: `telegramSession` and `telegramBusy` are module-level variables in `src/index.ts:164-165`. Busy check prevents concurrent agent invocations.

Progress bar format: `[████████░░░░░░░░░░░░] 40%` (no bin numbers, no arrows)

---

## Race Condition: Double Deploy

`_screeningLastTriggered` in `src/index.ts` prevents concurrent screener invocations. Management cycle sets this before triggering screener. Also, `deploy_position` safety check uses `force: true` on `getMyPositions()` for a fresh count.

---

## Bundler Detection (token.ts)

Two signals used in `getTokenHolders()`:
- `common_funder` — multiple wallets funded by same source
- `funded_same_window` — multiple wallets funded in same time window

**Thresholds in config**: `maxBundlersPct` (default 30%), `maxTop10Pct` (default 60%)
Jupiter audit API: `botHoldersPercentage` (5–25% is normal for legitimate tokens)

---

## Base Fee Calculation (dlmm.ts)

Read from pool object at deploy time:
```ts
const baseFactor = pool.lbPair.parameters?.baseFactor ?? 0;
const actualBaseFee = baseFactor > 0
  ? parseFloat((baseFactor * actualBinStep / 1e6 * 100).toFixed(4))
  : null;
```

---

## Model Configuration

- Default model: `process.env.LLM_MODEL` or `openrouter/healer-alpha`
- Fallback on 502/503/529: `stepfun/step-3.5-flash:free` (2nd attempt), then retry
- Per-role models: `managementModel`, `screeningModel`, `generalModel` in `src/core/config/user-config.json`
- LM Studio: set `LLM_BASE_URL=http://localhost:1234/v1` and `LLM_API_KEY=lm-studio`
- `maxOutputTokens` minimum: 2048 (free models may have lower limits causing empty responses)

---

## Lessons System

`src/core/state/lessons.ts` records closed position performance and auto-derives lessons. Key points:
- `getLessonsForPrompt({ agentType })` — injects relevant lessons into system prompt
- `evolveThresholds()` — adjusts screening thresholds based on winners vs losers
- Performance recorded via `recordPerformance()` called from executor.ts after `close_position`
- Outcomes: `good` (pnl≥5 or feeYield≥2%), `neutral` (0≤pnl<5), `poor` (-5≤pnl<0), `bad` (pnl<-5)
- **Known issue**: `derivLesson()` never creates lessons for `poor` outcome (only handles good/bad at line 188, `rule` stays empty, returns null at line 207) — confidence logic at lines 227-229 is dead code
- **Known issue**: `evolveThresholds()` second fee_tvl branch (lines 320-322) requires losers to have fee_tvl ratio within 1.5× of winners AND winners to have higher min fee — rarely triggered

---

## HiveMind

Agent Meridian HiveMind sync is handled by `src/services/hivemind.ts`. It uses built-in Agent Meridian defaults unless overridden by config or env.

---

## Environment Variables

| Var | Required | Purpose |
|-----|----------|---------|
| `WALLET_PRIVATE_KEY` | Yes | Base58 or JSON array private key |
| `RPC_URL` | Yes | Solana RPC endpoint |
| `OPENROUTER_API_KEY` | Yes | LLM API key |
| `TELEGRAM_BOT_TOKEN` | No | Telegram notifications |
| `TELEGRAM_CHAT_ID` | No | Telegram chat target |
| `TELEGRAM_ALLOWED_USER_IDS` | No | Comma-separated user IDs for command control |
| `LLM_BASE_URL` | No | Override for local LLM (e.g. LM Studio) |
| `LLM_MODEL` | No | Override default model |
| `DRY_RUN` | No | Skip all on-chain transactions |
| `HIVE_MIND_URL` | No | Collective intelligence server |
| `HIVE_MIND_API_KEY` | No | Hive mind auth token |
| `HELIUS_API_KEY` | No | Enhanced wallet balance data |

---

## Known Issues / Tech Debt

None.
