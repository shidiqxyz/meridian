import { config } from "../core/config/config.js";
import { log } from "../core/logger/logger.js";
import { agentMeridianJson, getAgentMeridianHeaders } from "./agent-meridian.js";

const DEFAULT_INTERVALS = ["5_MINUTE"];
const DEFAULT_CANDLES = 298;

interface CandlePoint {
  close?: number | string | null;
}

interface RsiData {
  value?: number | string | null;
}

interface BollingerData {
  lower?: number | string | null;
  middle?: number | string | null;
  upper?: number | string | null;
}

interface SupertrendData {
  value?: number | string | null;
  direction?: string | null;
}

interface FibonacciLevels {
  "0.500"?: number | string | null;
  "0.618"?: number | string | null;
  "0.786"?: number | string | null;
  [key: string]: number | string | null | undefined;
}

interface IndicatorPayload {
  candle?: CandlePoint;
  previousCandle?: CandlePoint;
  rsi?: RsiData;
  bollinger?: BollingerData;
  supertrend?: SupertrendData;
  fibonacci?: { levels?: FibonacciLevels | null } | null;
  states?: {
    supertrendBreakUp?: boolean;
    supertrendBreakDown?: boolean;
  } | null;
  latest?: IndicatorPayload | null;
}

interface SignalSummary {
  close: number | null;
  previousClose: number | null;
  rsi: number | null;
  lowerBand: number | null;
  middleBand: number | null;
  upperBand: number | null;
  supertrendValue: number | null;
  supertrendDirection: string | null;
  supertrendBreakUp: boolean;
  supertrendBreakDown: boolean;
  fib50: number | null;
  fib618: number | null;
  fib786: number | null;
}

export interface IndicatorResult {
  enabled: boolean;
  confirmed: boolean;
  skipped?: boolean;
  preset?: string;
  side?: string;
  reason: string;
  intervals: Array<{
    interval: string;
    ok: boolean;
    confirmed: boolean | null;
    reason: string;
    signal: SignalSummary | null;
  }>;
}

function safeNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeIntervals(intervals: unknown): string[] {
  const list = Array.isArray(intervals) ? intervals : DEFAULT_INTERVALS;
  return list
    .map((value) => String(value || "").trim().toUpperCase())
    .filter((value) => value === "5_MINUTE" || value === "15_MINUTE");
}

function buildSignalSummary(payload: IndicatorPayload): SignalSummary {
  const latest = payload.latest ?? payload;
  const candle = latest.candle ?? {};
  const previousCandle = latest.previousCandle ?? {};
  const bollinger = latest.bollinger ?? {};
  const supertrend = latest.supertrend ?? {};
  const fibonacciLevels = latest.fibonacci?.levels ?? {};

  return {
    close: safeNum(candle.close),
    previousClose: safeNum(previousCandle.close),
    rsi: safeNum(latest.rsi?.value),
    lowerBand: safeNum(bollinger.lower),
    middleBand: safeNum(bollinger.middle),
    upperBand: safeNum(bollinger.upper),
    supertrendValue: safeNum(supertrend.value),
    supertrendDirection: supertrend.direction ? String(supertrend.direction) : null,
    supertrendBreakUp: Boolean(latest.states?.supertrendBreakUp),
    supertrendBreakDown: Boolean(latest.states?.supertrendBreakDown),
    fib50: safeNum(fibonacciLevels["0.500"]),
    fib618: safeNum(fibonacciLevels["0.618"]),
    fib786: safeNum(fibonacciLevels["0.786"]),
  };
}

function evaluatePreset(side: string, preset: string, payload: IndicatorPayload): { confirmed: boolean; reason: string; signal: SignalSummary } {
  const summary = buildSignalSummary(payload);
  const oversold = Number(config.indicators.rsiOversold ?? 30);
  const overbought = Number(config.indicators.rsiOverbought ?? 80);
  const close = summary.close;
  const previousClose = summary.previousClose;
  const lowerBand = summary.lowerBand;
  const upperBand = summary.upperBand;
  const rsi = summary.rsi;
  const isBullish = summary.supertrendDirection === "bullish";
  const isBearish = summary.supertrendDirection === "bearish";

  const crossedUp = (level: number | null): boolean =>
    level != null &&
    close != null &&
    previousClose != null &&
    previousClose < level &&
    close >= level;

  const crossedDown = (level: number | null): boolean =>
    level != null &&
    close != null &&
    previousClose != null &&
    previousClose > level &&
    close <= level;

  switch (preset) {
    case "supertrend_break":
      return side === "entry"
        ? {
            confirmed: summary.supertrendBreakUp || Boolean(isBullish && close != null && summary.supertrendValue != null && close >= summary.supertrendValue),
            reason: summary.supertrendBreakUp ? "Supertrend flipped bullish" : "Price is above bullish Supertrend",
            signal: summary,
          }
        : {
            confirmed: summary.supertrendBreakDown || Boolean(isBearish && close != null && summary.supertrendValue != null && close <= summary.supertrendValue),
            reason: summary.supertrendBreakDown ? "Supertrend flipped bearish" : "Price is below bearish Supertrend",
            signal: summary,
          };
    case "rsi_reversal":
      return side === "entry"
        ? { confirmed: rsi != null && rsi <= oversold, reason: `RSI ${rsi ?? "n/a"} <= oversold ${oversold}`, signal: summary }
        : { confirmed: rsi != null && rsi >= overbought, reason: `RSI ${rsi ?? "n/a"} >= overbought ${overbought}`, signal: summary };
    case "bollinger_reversal":
      return side === "entry"
        ? { confirmed: close != null && lowerBand != null && close <= lowerBand, reason: `Close ${close ?? "n/a"} <= lower band ${lowerBand ?? "n/a"}`, signal: summary }
        : { confirmed: close != null && upperBand != null && close >= upperBand, reason: `Close ${close ?? "n/a"} >= upper band ${upperBand ?? "n/a"}`, signal: summary };
    case "rsi_plus_supertrend":
      return side === "entry"
        ? {
            confirmed: Boolean((rsi != null && rsi <= oversold) && (summary.supertrendBreakUp || (isBullish && close != null && summary.supertrendValue != null && close >= summary.supertrendValue))),
            reason: "RSI oversold with bullish Supertrend context",
            signal: summary,
          }
        : {
            confirmed: Boolean((rsi != null && rsi >= overbought) && (summary.supertrendBreakDown || (isBearish && close != null && summary.supertrendValue != null && close <= summary.supertrendValue))),
            reason: "RSI overbought with bearish Supertrend context",
            signal: summary,
          };
    case "supertrend_or_rsi":
      return side === "entry"
        ? {
            confirmed: Boolean(summary.supertrendBreakUp || (isBullish && close != null && summary.supertrendValue != null && close >= summary.supertrendValue) || (rsi != null && rsi <= oversold)),
            reason: "Supertrend bullish confirmation or RSI oversold",
            signal: summary,
          }
        : {
            confirmed: Boolean(summary.supertrendBreakDown || (isBearish && close != null && summary.supertrendValue != null && close <= summary.supertrendValue) || (rsi != null && rsi >= overbought)),
            reason: "Supertrend bearish confirmation or RSI overbought",
            signal: summary,
          };
    case "bb_plus_rsi":
      return side === "entry"
        ? {
            confirmed: Boolean((close != null && lowerBand != null && close <= lowerBand) || (rsi != null && rsi <= oversold)),
            reason: "Close at/below lower band with RSI oversold",
            signal: summary,
          }
        : {
            confirmed: Boolean((close != null && upperBand != null && close >= upperBand) || (rsi != null && rsi >= overbought)),
            reason: "Close at/above upper band with RSI overbought",
            signal: summary,
          };
    case "fibo_reclaim":
      return {
        confirmed: crossedUp(summary.fib618) || crossedUp(summary.fib50) || crossedUp(summary.fib786),
        reason: side === "entry" ? "Price reclaimed a key Fibonacci level" : "Price reclaimed a key Fibonacci level upward",
        signal: summary,
      };
    case "fibo_reject":
      return {
        confirmed: crossedDown(summary.fib618) || crossedDown(summary.fib50) || crossedDown(summary.fib786),
        reason: side === "entry" ? "Price rejected from a key Fibonacci level" : "Price rejected below a key Fibonacci level",
        signal: summary,
      };
    default:
      return {
        confirmed: false,
        reason: `Unknown preset ${preset}`,
        signal: summary,
      };
  }
}

async function fetchChartIndicatorsForMint(
  mint: string,
  options: {
    interval?: string;
    candles?: number;
    rsiLength?: number;
    refresh?: boolean;
  } = {},
): Promise<IndicatorPayload> {
  const interval = options.interval ?? "15_MINUTE";
  const candles = options.candles ?? config.indicators.candles ?? DEFAULT_CANDLES;
  const rsiLength = options.rsiLength ?? config.indicators.rsiLength ?? 2;
  const refresh = options.refresh ?? false;

  const search = new URLSearchParams({
    interval: String(interval).trim().toUpperCase(),
    candles: String(candles),
    rsiLength: String(rsiLength),
  });
  if (refresh) search.set("refresh", "1");

  const response = await agentMeridianJson(`/chart-indicators/${mint}?${search.toString()}`, {
    headers: getAgentMeridianHeaders(),
  });
  return (response?.payload ?? response) as IndicatorPayload;
}

export async function confirmIndicatorPreset({
  mint,
  side,
  preset = side === "entry" ? config.indicators.entryPreset : config.indicators.exitPreset,
  intervals = config.indicators.intervals,
  refresh = false,
}: {
  mint: string;
  side: string;
  preset?: string;
  intervals?: unknown;
  refresh?: boolean;
}): Promise<IndicatorResult> {
  if (!config.indicators.enabled || !mint || !preset) {
    return {
      enabled: false,
      confirmed: true,
      reason: "Indicators disabled or not configured",
      intervals: [],
    };
  }

  const targets = normalizeIntervals(intervals);
  if (targets.length === 0) {
    return {
      enabled: false,
      confirmed: true,
      reason: "No indicator intervals configured",
      intervals: [],
    };
  }

  const results: IndicatorResult["intervals"] = [];

  for (const interval of targets) {
    try {
      const payload = await fetchChartIndicatorsForMint(mint, { interval, refresh });
      const evaluation = evaluatePreset(side, preset, payload);
      results.push({
        interval,
        ok: true,
        confirmed: evaluation.confirmed,
        reason: evaluation.reason,
        signal: evaluation.signal,
      });
    } catch (error: unknown) {
      log("indicators_warn", `Indicator fetch failed for ${mint.slice(0, 8)} ${interval}: ${(error as Error).message}`);
      results.push({
        interval,
        ok: false,
        confirmed: null,
        reason: `Indicator unavailable: ${(error as Error).message}`,
        signal: null,
      });
    }
  }

  const successful = results.filter((entry) => entry.ok);
  if (successful.length === 0) {
    return {
      enabled: true,
      confirmed: true,
      skipped: true,
      preset,
      side,
      reason: "Indicator API unavailable; falling back to existing logic",
      intervals: results,
    };
  }

  const requireAll = Boolean(config.indicators.requireAllIntervals);
  const confirmed = requireAll
    ? successful.every((entry) => entry.confirmed)
    : successful.some((entry) => entry.confirmed);

  return {
    enabled: true,
    confirmed,
    skipped: false,
    preset,
    side,
    reason: confirmed
      ? `${preset} confirmed on ${successful.filter((entry) => entry.confirmed).map((entry) => entry.interval).join(", ")}`
      : `${preset} not confirmed on ${successful.map((entry) => entry.interval).join(", ")}`,
    intervals: results,
  };
}
