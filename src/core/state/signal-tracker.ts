/**
 * signal-tracker.js — Stages screening signals for later attribution.
 *
 * Deploy-time persistence is not currently wired, so staged signals are
 * short-lived context rather than durable performance data.
 */

// In-memory staging area — cleared after retrieval or after 10 minutes
const _staged = new Map<string, { staged_at: number; [key: string]: unknown }>();
const STAGE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface SignalData {
  organic_score?: number;
  fee_tvl_ratio?: number;
  volume?: number;
  mcap?: number;
  holder_count?: number;
  smart_wallets_present?: boolean;
  narrative_quality?: string;
  study_win_rate?: number;
  hive_consensus?: number;
  volatility?: number;
  [key: string]: unknown;
}

/**
 * Stage signals for a pool during screening.
 * Called after candidate data is loaded, before the LLM decides.
 */
export function stageSignals(poolAddress: string, signals: SignalData): void {
  _staged.set(poolAddress, {
    ...signals,
    staged_at: Date.now(),
  });
  // Clean up stale entries
  for (const [addr, data] of _staged) {
    if (Date.now() - data.staged_at > STAGE_TTL_MS) {
      _staged.delete(addr);
    }
  }
}

/**
 * Retrieve and clear staged signals for a pool.
 * Returns null if no signals are staged.
 */
export function consumeSignals(poolAddress: string): SignalData | null {
  const data = _staged.get(poolAddress);
  if (!data) return null;
  _staged.delete(poolAddress);
  return data as SignalData;
}
