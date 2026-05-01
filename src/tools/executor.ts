import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";
import type { ToolMap } from "../core/types/tools.js";
import {
  discoverPools, getPoolDetail, getTopCandidates, pickBestCandidate } from "./screening.js";
import {
  getActiveBin,
  deployPosition,
  getMyPositions,
  getWalletPositions,
  getPositionPnl,
  claimFees,
  closePosition,
  searchPools,
} from "./dlmm.js";
import { getWalletBalances, swapToken } from "./wallet.js";
import { studyTopLPers } from "./study.js";
import {
  addLesson,
  clearAllLessons,
  clearPerformance,
  removeLessonsByKeyword,
  getPerformanceHistory,
  pinLesson,
  unpinLesson,
  listLessons,
} from "../core/state/lessons.js";
import { setPositionInstruction } from "../core/state/state.js";
import { getPoolMemory, addPoolNote } from "../core/state/pool-memory.js";
import {
  addStrategy,
  listStrategies,
  getStrategy,
  setActiveStrategy,
  removeStrategy,
} from "../core/state/strategy-library.js";
import { addToBlacklist, removeFromBlacklist, listBlacklist } from "../services/token-blacklist.js";
import { blockDev, unblockDev, listBlockedDevs } from "../services/dev-blocklist.js";
import { addSmartWallet, removeSmartWallet, listSmartWallets, checkSmartWalletsOnPool } from "../services/smart-wallets.js";
import { getTokenInfo, getTokenHolders, getTokenNarrative } from "./token.js";
import { config, reloadScreeningThresholds } from "../core/config/config.js";
import { getRecentDecisions } from "../core/state/decision-log.js";
import { log, logAction } from "../core/logger/logger.js";
import { notifyClose, notifyDeploy, notifySwap } from "../services/telegram.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "../core/config/user-config.json");

let cronRestarter: (() => void) | null = null;

export function registerCronRestarter(fn: () => void): void {
  cronRestarter = fn;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function coerceBoolean(value: unknown, key: string): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  throw new Error(`${key} must be true or false`);
}

function coerceFiniteNumber(value: unknown, key: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error(`${key} must be a finite number`);
  return num;
}

function coerceString(value: unknown, key: string): string {
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value.trim();
}

function coerceStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${key} must be an array of strings`);
  return value.map((entry) => coerceString(entry, key)).filter(Boolean);
}

function normalizeConfigValue(key: string, value: unknown): unknown {
  const booleanKeys = new Set([
    "excludeHighSupplyConcentration",
    "useDiscordSignals",
    "avoidPvpSymbols",
    "blockPvpSymbols",
    "autoSwapAfterClaim",
    "trailingTakeProfit",
    "solMode",
    "darwinEnabled",
    "lpAgentRelayEnabled",
    "chartIndicatorsEnabled",
    "requireAllIntervals",
    "hiveMindEnabled",
  ]);
  const arrayKeys = new Set(["allowedLaunchpads", "blockedLaunchpads", "indicatorIntervals"]);
  const stringKeys = new Set([
    "timeframe",
    "category",
    "discordSignalMode",
    "strategy",
    "managementModel",
    "screeningModel",
    "generalModel",
    "hiveMindUrl",
    "hiveMindApiKey",
    "agentId",
    "hiveMindPullMode",
    "publicApiKey",
    "agentMeridianApiUrl",
    "indicatorEntryPreset",
    "indicatorExitPreset",
  ]);

  if (value === null) return null;
  if (booleanKeys.has(key)) return coerceBoolean(value, key);
  if (arrayKeys.has(key)) return coerceStringArray(value, key);
  if (stringKeys.has(key)) return coerceString(value, key);
  return coerceFiniteNumber(value, key);
}

function loadUserConfig(): Record<string, unknown> {
  if (!fs.existsSync(USER_CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
}

function persistUserConfig(userConfig: Record<string, unknown>): void {
  fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(userConfig, null, 2));
}

function toolSetPositionNote(args: { position_address: string; instruction: string | null }): Record<string, unknown> {
  const ok = setPositionInstruction(args.position_address, args.instruction || null);
  if (!ok) return { error: `Position ${args.position_address} not found in state` };
  return { saved: true, position: args.position_address, instruction: args.instruction || null };
}

function toolAddLesson(args: { rule: string; tags?: string[]; pinned?: boolean; role?: string | null }): Record<string, unknown> {
  addLesson(args.rule, args.tags || [], { pinned: !!args.pinned, role: args.role || null });
  return { saved: true, rule: args.rule, pinned: !!args.pinned, role: args.role || "all" };
}

function toolClearLessons(args: { mode?: string; keyword?: string } = {}): Record<string, unknown> {
  if (args.mode === "all") {
    const cleared = clearAllLessons();
    log("lessons", `Cleared all ${cleared} lessons`);
    return { cleared, mode: "all" };
  }
  if (args.mode === "performance") {
    const cleared = clearPerformance();
    log("lessons", `Cleared ${cleared} performance records`);
    return { cleared, mode: "performance" };
  }
  if (args.mode === "keyword") {
    if (!args.keyword) return { error: "keyword required for mode=keyword" };
    const cleared = removeLessonsByKeyword(args.keyword);
    log("lessons", `Cleared ${cleared} lessons matching "${args.keyword}"`);
    return { cleared, mode: "keyword", keyword: args.keyword };
  }
  return { error: "invalid mode" };
}

function toolUpdateConfig(args: { changes: Record<string, unknown>; reason?: string }): Record<string, unknown> {
  const { changes, reason = "" } = args;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return { success: false, error: "changes must be an object", reason };
  }

  const configMap: Record<string, [string, string]> = {
    minFeeActiveTvlRatio: ["screening", "minFeeActiveTvlRatio"],
    excludeHighSupplyConcentration: ["screening", "excludeHighSupplyConcentration"],
    minTvl: ["screening", "minTvl"],
    maxTvl: ["screening", "maxTvl"],
    minVolume: ["screening", "minVolume"],
    minOrganic: ["screening", "minOrganic"],
    minQuoteOrganic: ["screening", "minQuoteOrganic"],
    minHolders: ["screening", "minHolders"],
    minMcap: ["screening", "minMcap"],
    maxMcap: ["screening", "maxMcap"],
    minBinStep: ["screening", "minBinStep"],
    maxBinStep: ["screening", "maxBinStep"],
    timeframe: ["screening", "timeframe"],
    category: ["screening", "category"],
    minTokenFeesSol: ["screening", "minTokenFeesSol"],
    useDiscordSignals: ["screening", "useDiscordSignals"],
    discordSignalMode: ["screening", "discordSignalMode"],
    avoidPvpSymbols: ["screening", "avoidPvpSymbols"],
    blockPvpSymbols: ["screening", "blockPvpSymbols"],
    maxBundlePct: ["screening", "maxBundlePct"],
    maxBotHoldersPct: ["screening", "maxBotHoldersPct"],
    maxTop10Pct: ["screening", "maxTop10Pct"],
    allowedLaunchpads: ["screening", "allowedLaunchpads"],
    blockedLaunchpads: ["screening", "blockedLaunchpads"],
    minTokenAgeHours: ["screening", "minTokenAgeHours"],
    maxTokenAgeHours: ["screening", "maxTokenAgeHours"],
    athFilterPct: ["screening", "athFilterPct"],
    maxVolatility: ["screening", "maxVolatility"],
    minClaimAmount: ["management", "minClaimAmount"],
    autoSwapAfterClaim: ["management", "autoSwapAfterClaim"],
    outOfRangeBinsToClose: ["management", "outOfRangeBinsToClose"],
    outOfRangeWaitMinutes: ["management", "outOfRangeWaitMinutes"],
    oorCooldownTriggerCount: ["management", "oorCooldownTriggerCount"],
    oorCooldownHours: ["management", "oorCooldownHours"],
    repeatDeployCooldownEnabled: ["management", "repeatDeployCooldownEnabled"],
    repeatDeployCooldownTriggerCount: ["management", "repeatDeployCooldownTriggerCount"],
    repeatDeployCooldownHours: ["management", "repeatDeployCooldownHours"],
    repeatDeployCooldownScope: ["management", "repeatDeployCooldownScope"],
    repeatDeployCooldownMinFeeEarnedPct: ["management", "repeatDeployCooldownMinFeeEarnedPct"],
    minVolumeToRebalance: ["management", "minVolumeToRebalance"],
    stopLossPct: ["management", "stopLossPct"],
    takeProfitPct: ["management", "takeProfitPct"],
    takeProfitFeePct: ["management", "takeProfitPct"],
    minFeePerTvl24h: ["management", "minFeePerTvl24h"],
    minAgeBeforeYieldCheck: ["management", "minAgeBeforeYieldCheck"],
    minSolToOpen: ["management", "minSolToOpen"],
    deployAmountSol: ["management", "deployAmountSol"],
    gasReserve: ["management", "gasReserve"],
    positionSizePct: ["management", "positionSizePct"],
    trailingTakeProfit: ["management", "trailingTakeProfit"],
    trailingTriggerPct: ["management", "trailingTriggerPct"],
    trailingDropPct: ["management", "trailingDropPct"],
    pnlSanityMaxDiffPct: ["management", "pnlSanityMaxDiffPct"],
    solMode: ["management", "solMode"],
    maxPositions: ["risk", "maxPositions"],
    maxDeployAmount: ["risk", "maxDeployAmount"],
    managementIntervalMin: ["schedule", "managementIntervalMin"],
    screeningIntervalMin: ["schedule", "screeningIntervalMin"],
    healthCheckIntervalMin: ["schedule", "healthCheckIntervalMin"],
    temperature: ["llm", "temperature"],
    maxTokens: ["llm", "maxTokens"],
    maxSteps: ["llm", "maxSteps"],
    managementModel: ["llm", "managementModel"],
    screeningModel: ["llm", "screeningModel"],
    generalModel: ["llm", "generalModel"],
    strategy: ["strategy", "strategy"],
    binsBelow: ["strategy", "binsBelow"],
    hiveMindUrl: ["hiveMind", "url"],
    hiveMindApiKey: ["hiveMind", "apiKey"],
    hiveMindEnabled: ["hiveMind", "enabled"],
    agentId: ["hiveMind", "agentId"],
    hiveMindPullMode: ["hiveMind", "pullMode"],
    publicApiKey: ["api", "publicApiKey"],
    agentMeridianApiUrl: ["api", "url"],
    lpAgentRelayEnabled: ["api", "lpAgentRelayEnabled"],
    chartIndicatorsEnabled: ["indicators", "enabled"],
    indicatorEntryPreset: ["indicators", "entryPreset"],
    indicatorExitPreset: ["indicators", "exitPreset"],
    rsiLength: ["indicators", "rsiLength"],
    indicatorIntervals: ["indicators", "intervals"],
    indicatorCandles: ["indicators", "candles"],
    rsiOversold: ["indicators", "rsiOversold"],
    rsiOverbought: ["indicators", "rsiOverbought"],
    requireAllIntervals: ["indicators", "requireAllIntervals"],
  };

  const configMapLower: Record<string, [string, [string, string]]> = Object.fromEntries(
    Object.entries(configMap).map(([key, value]) => [key.toLowerCase(), [key, value]]),
  );

  const applied: Record<string, unknown> = {};
  const unknown: string[] = [];

  for (const [key, value] of Object.entries(changes)) {
    const match = configMap[key] ? [key, configMap[key]] as [string, [string, string]] : configMapLower[key.toLowerCase()];
    if (!match) {
      unknown.push(key);
      continue;
    }
    try {
      applied[match[0]] = normalizeConfigValue(match[0], value);
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, key: match[0], reason };
    }
  }

  if (Object.keys(applied).length === 0) {
    return { success: false, unknown, reason };
  }

  const userConfig = loadUserConfig();
  const liveConfig = config as unknown as Record<string, Record<string, unknown>>;

  for (const [key, value] of Object.entries(applied)) {
    const [section, field] = configMap[key];
    if (!liveConfig[section]) liveConfig[section] = {};
    liveConfig[section][field] = value;

    if (!userConfig[section] || typeof userConfig[section] !== "object" || Array.isArray(userConfig[section])) {
      userConfig[section] = {};
    }
    (userConfig[section] as Record<string, unknown>)[field] = value;
  }

  userConfig._lastAgentTune = new Date().toISOString();
  persistUserConfig(userConfig);
  reloadScreeningThresholds();

  if ((applied.managementIntervalMin != null || applied.screeningIntervalMin != null) && cronRestarter) {
    cronRestarter();
  }

  const lessonsKeys = Object.keys(applied).filter((key) => key !== "managementIntervalMin" && key !== "screeningIntervalMin");
  if (lessonsKeys.length > 0) {
    const summary = lessonsKeys.map((key) => `${key}=${applied[key]}`).join(", ");
    addLesson(`[SELF-TUNED] Changed ${summary} - ${reason}`, ["self_tune", "config_change"]);
  }

  return { success: true, applied, unknown, reason };
}

const toolMap: ToolMap = {
  discover_pools: (args) => discoverPools(args),
  get_top_candidates: (args) => getTopCandidates(args),
  pick_best_candidate: () => pickBestCandidate(),
  get_pool_detail: (args) => getPoolDetail(args),
  get_position_pnl: (args) => getPositionPnl(args),
  get_active_bin: (args) => getActiveBin(args),
  deploy_position: (args) => deployPosition(args),
  get_my_positions: (args) => getMyPositions(args),
  get_wallet_positions: (args) => getWalletPositions(args),
  search_pools: (args) => searchPools(args),
  get_token_info: (args) => getTokenInfo(args),
  get_token_holders: (args) => getTokenHolders(args),
  get_token_narrative: (args) => getTokenNarrative(args),
  add_smart_wallet: (args) => addSmartWallet(args),
  remove_smart_wallet: (args) => removeSmartWallet(args),
  list_smart_wallets: () => listSmartWallets(),
  check_smart_wallets_on_pool: (args) => checkSmartWalletsOnPool(args),
  claim_fees: (args) => claimFees(args),
  close_position: (args) => closePosition(args),
  get_wallet_balance: () => getWalletBalances(),
  swap_token: (args) => swapToken(args),
  get_top_lpers: (args) => studyTopLPers(args),
  study_top_lpers: (args) => studyTopLPers(args),
  set_position_note: (args) => toolSetPositionNote(args),
  get_performance_history: () => getPerformanceHistory(),
  get_recent_decisions: (args) => ({ decisions: getRecentDecisions(asNumber(args?.limit) || 6) }),
  add_strategy: (args) => addStrategy(args),
  list_strategies: () => listStrategies(),
  get_strategy: (args) => getStrategy(args),
  set_active_strategy: (args) => setActiveStrategy(args),
  remove_strategy: (args) => removeStrategy(args),
  get_pool_memory: (args) => getPoolMemory(args),
  add_pool_note: (args) => addPoolNote(args),
  add_to_blacklist: (args) => addToBlacklist(args),
  remove_from_blacklist: (args) => removeFromBlacklist(args),
  list_blacklist: () => listBlacklist(),
  block_deployer: (args) => blockDev(args),
  unblock_deployer: (args) => unblockDev(args),
  list_blocked_deployers: () => listBlockedDevs(),
  add_lesson: (args) => toolAddLesson(args),
  pin_lesson: (args) => pinLesson(args.id),
  unpin_lesson: (args) => unpinLesson(args.id),
  list_lessons: (args) => listLessons({
    role: args?.role ?? null,
    pinned: args?.pinned ?? null,
    tag: args?.tag ?? null,
    limit: args?.limit,
  }),
  clear_lessons: (args) => toolClearLessons(args),
  update_config: (args) => toolUpdateConfig(args),
};

const WRITE_TOOLS = new Set(["deploy_position", "claim_fees", "close_position", "swap_token"]);
const PROTECTED_TOOLS = new Set([...WRITE_TOOLS]);

function summarizeResult(result: Record<string, unknown>): Record<string, unknown> {
  const str = JSON.stringify(result);
  if (str.length > 1000) return { ...result, _truncated: true };
  return result;
}

async function maybeNotifyAndAutomanage(name: string, args: Record<string, unknown>, result: Record<string, any>): Promise<void> {
  if (name === "swap_token" && (result.tx || result.txs?.[0])) {
    await notifySwap({
      inputSymbol: asString(args.input_mint)?.slice(0, 8) || "",
      outputSymbol: asString(args.output_mint) === "So11111111111111111111111111111111111112" || asString(args.output_mint) === "SOL"
        ? "SOL"
        : asString(args.output_mint)?.slice(0, 8) || "",
      amountIn: result.amount_in,
      amountOut: result.amount_out,
      tx: result.txs?.[0] ?? result.tx,
    }).catch((error: unknown) => log("notify_error", `Failed to send swap notification: ${(error as Error).message}`));
  }

  if (name === "deploy_position") {
    await notifyDeploy({
      pair: asString(result.pool_name) || asString(args.pool_name) || asString(args.pool_address)?.slice(0, 8) || "",
      amountSol: asNumber(args.amount_y ?? args.amount_sol) ?? 0,
      position: result.position,
      tx: result.txs?.[0] ?? result.tx,
      priceRange: result.price_range,
      rangeCoverage: result.range_coverage,
      binStep: result.bin_step,
      baseFee: result.base_fee,
    }).catch((error: unknown) => log("notify_error", `Failed to send deploy notification: ${(error as Error).message}`));
  }

  if (name === "close_position") {
    await notifyClose({
      pair: asString(result.pool_name) || asString(args.position_address)?.slice(0, 8) || "",
      pnlUsd: asNumber(result.pnl_usd) ?? 0,
      pnlPct: asNumber(result.pnl_pct) ?? 0,
    }).catch((error: unknown) => log("notify_error", `Failed to send close notification: ${(error as Error).message}`));

    const reason = asString(args.reason)?.toLowerCase();
    const poolAddress = asString(result.pool) || asString(args.pool_address);
    if (reason?.includes("yield") && poolAddress) {
      addPoolNote({
        pool_address: poolAddress,
        note: `Closed: low yield (fee/TVL below threshold) at ${new Date().toISOString().slice(0, 10)}`,
      });
    }

    const baseMint = asString(result.base_mint);
    if (!args.skip_swap && baseMint) {
      try {
        const balances = await getWalletBalances();
        const token = balances.tokens?.find((entry) => entry.mint === baseMint);
        if (token && (token.usd ?? 0) >= 0.1) {
          log("executor", `Auto-swapping ${token.symbol || baseMint.slice(0, 8)} (${(token.usd ?? 0).toFixed(2)}) back to SOL...`);
          const swapResult = await swapToken({ input_mint: baseMint, output_mint: "SOL", amount: token.balance });
          result.auto_swapped = true;
          if (swapResult?.amount_out) {
            result.sol_received = swapResult.amount_out;
            log("executor", `Auto-swap successful: received ${swapResult.amount_out} SOL`);
          }
        } else if (token) {
          result.auto_swap_note = `Base token ${token.symbol || baseMint.slice(0, 8)} value $${(token.usd ?? 0).toFixed(2)} is dust (< $0.10) — skipping auto-swap.`;
        }
      } catch (error: unknown) {
        log("executor_warn", `Auto-swap after close failed: ${(error as Error).message}`);
        result.auto_swap_error = (error as Error).message;
      }
    }
  }

  if (name === "claim_fees" && config.management.autoSwapAfterClaim) {
    const baseMint = asString(result.base_mint);
    if (!baseMint) return;
    try {
      const balances = await getWalletBalances();
      const token = balances.tokens?.find((entry) => entry.mint === baseMint);
      if (token && (token.usd ?? 0) >= 0.1) {
        await swapToken({ input_mint: baseMint, output_mint: "SOL", amount: token.balance });
      }
    } catch (error: unknown) {
      log("executor_warn", `Auto-swap after claim failed: ${(error as Error).message}`);
    }
  }
}

async function runSafetyChecks(name: string, args: Record<string, unknown>): Promise<{ pass: boolean; reason?: string }> {
  if (name === "deploy_position") {
    const binStep = asNumber(args.bin_step);
    if (binStep != null && (binStep < config.screening.minBinStep || binStep > config.screening.maxBinStep)) {
      return {
        pass: false,
        reason: `bin_step ${binStep} is outside the allowed range of [${config.screening.minBinStep}-${config.screening.maxBinStep}].`,
      };
    }

    const positions = await getMyPositions({ force: true });
    if (positions.total_positions >= config.risk.maxPositions) {
      return { pass: false, reason: `Max positions (${config.risk.maxPositions}) reached. Close a position first.` };
    }

    const poolAddress = asString(args.pool_address);
    if (poolAddress && positions.positions.some((position: any) => position.pool === poolAddress)) {
      return { pass: false, reason: `Already have an open position in pool ${poolAddress}. Cannot open duplicate.` };
    }

    const baseMint = asString(args.base_mint);
    if (baseMint && positions.positions.some((position: any) => position.base_mint === baseMint)) {
      return { pass: false, reason: `Already holding base token ${baseMint} in another pool. One position per token only.` };
    }

    const amountY = asNumber(args.amount_y ?? args.amount_sol) ?? 0;
    if (amountY <= 0) {
      return { pass: false, reason: "Must provide a positive SOL amount (amount_y)." };
    }
    const minDeploy = Math.max(0.1, config.management.deployAmountSol);
    if (amountY < minDeploy) {
      return { pass: false, reason: `Amount ${amountY} SOL is below the minimum deploy amount (${minDeploy} SOL).` };
    }
    if (amountY > config.risk.maxDeployAmount) {
      return { pass: false, reason: `SOL amount ${amountY} exceeds maximum allowed per position (${config.risk.maxDeployAmount}).` };
    }

    if (process.env.DRY_RUN !== "true") {
      const balance = await getWalletBalances();
      const minRequired = amountY + config.management.gasReserve;
      if (balance.sol < minRequired) {
        return {
          pass: false,
          reason: `Insufficient SOL: have ${balance.sol} SOL, need ${minRequired} SOL (${amountY} deploy + ${config.management.gasReserve} gas reserve).`,
        };
      }
    }
  }

  return { pass: true };
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const normalizedName = name.replace(/<.*$/, "").trim();
  const fn = toolMap[normalizedName];

  if (!fn) {
    return { success: false, error: `Unknown tool: ${normalizedName}` };
  }

  if (!fn) {
    const error = `Unknown tool: ${normalizedName}`;
    log("error", error);
    return { error };
  }

  if (PROTECTED_TOOLS.has(normalizedName)) {
    const safetyCheck = await runSafetyChecks(normalizedName, args);
    if (!safetyCheck.pass) {
      log("safety_block", `${normalizedName} blocked: ${safetyCheck.reason}`);
      return { blocked: true, reason: safetyCheck.reason };
    }
  }

  try {
    const result = await fn(args) as Record<string, any>;
    const success = result?.success !== false && !result?.error;
    const duration = Date.now() - startedAt;

    logAction({
      tool: normalizedName,
      args,
      result: summarizeResult(result),
      duration_ms: duration,
      success,
    });

    if (success) {
      await maybeNotifyAndAutomanage(normalizedName, args, result);
    }

    return result;
  } catch (error: unknown) {
    const duration = Date.now() - startedAt;
    logAction({
      tool: normalizedName,
      args,
      error: (error as Error).message,
      duration_ms: duration,
      success: false,
    });
    return {
      error: (error as Error).message,
      tool: normalizedName,
    };
  }
}
