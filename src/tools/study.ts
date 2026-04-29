import { agentMeridianJson, getAgentMeridianHeaders } from "./agent-meridian.js";

interface Owner {
  owner: string;
  ownerShort?: string;
  avgAgeHours?: number;
  totalLp?: number;
  pnlPerInflowPct?: number;
  feePercent?: number;
  totalPnlUsd?: number;
  totalInflowUsd?: number;
  avgPnlPct?: number;
  roiPct?: number;
  feePctOfCapital?: number;
  preferredStrategy?: string;
  preferredRangeStyle?: string;
  winRatePct?: number;
  topPositions?: any[];
  [key: string]: unknown;
}

interface HistoricalOwner {
  owner: string;
  preferredStrategy?: string;
  preferredRangeStyle?: string;
  topPositions?: any[];
  avgHoldHours?: number;
  avgPnlPct?: number;
  avgFeePercent?: number;
  roiPct?: number;
  [key: string]: unknown;
}

interface PoolData {
  topLpers?: Owner[];
  historicalOwners?: HistoricalOwner[];
  overview?: { name?: string; tokenXSymbol?: string; tokenYSymbol?: string };
  [key: string]: unknown;
}

interface SignalData {
  activePositionCount?: number;
  ownerCount?: number;
  suggestedStyle?: string;
  topHistoricalOwners?: HistoricalOwner[];
}

interface LperResult {
  owner: string;
  owner_short: string;
  signal_tags?: string[];
  summary: {
    total_positions: number;
    avg_hold_hours: number;
    avg_open_pnl_pct: number;
    avg_fee_per_tvl_24h_pct: number;
    total_pnl_usd: number;
    total_balance_usd: number;
    avg_range_width_pct: number;
    avg_distance_to_active_pct: number;
    win_rate: number;
    roi: number;
    fee_pct_of_capital: number;
    preferred_strategy: string;
    preferred_range_style: string;
  };
  positions: Array<{
    pool: string;
    pair: string;
    hold_hours: number;
    pnl_usd: number;
    pnl_pct: number;
    fee_usd: number;
    in_range_pct: number;
    strategy: string;
    closed_reason: string;
    balance_usd: number;
    fee_per_tvl_24h_pct: number;
    range_width_pct: number;
    distance_to_active_pct: number;
    lower_bin_id: number | null;
    upper_bin_id: number | null;
  }>;
}

interface PatternResult {
  top_lper_count: number;
  study_mode: string;
  pool_name: string;
  active_position_count: number;
  owner_count: number;
  avg_hold_hours: number;
  avg_open_pnl_pct: number;
  avg_fee_percent: number;
  avg_roi_pct: number;
  best_open_pnl_pct: string | null;
  scalper_count: number;
  holder_count: number;
  preferred_strategies: Record<string, number>;
  preferred_range_styles: Record<string, number>;
  top_historical_owners: HistoricalOwner[];
  suggested_style: string | null;
}

async function fetchTopLp(poolAddress: string): Promise<PoolData> {
  const response = await agentMeridianJson(`/top-lp/${poolAddress}`, {
    headers: getAgentMeridianHeaders(),
  });
  return (response?.payload ?? response) as PoolData;
}

async function fetchStudyTopLp(poolAddress: string): Promise<PoolData> {
  const response = await agentMeridianJson(`/study-top-lp/${poolAddress}`, {
    headers: getAgentMeridianHeaders(),
  });
  return (response?.payload ?? response) as PoolData;
}

function buildPatterns(
  ranked: Owner[],
  historicalOwners: HistoricalOwner[],
  signalData: SignalData,
  overview: PoolData['overview']
): PatternResult {
  const avgHold = avg(ranked.map((o) => o.avgAgeHours!).filter(isNum));
  const avgOpenPnlPct = avg(ranked.map((o) => o.pnlPerInflowPct!).filter(isNum));
  const avgFeePct = avg(ranked.map((o) => o.feePercent!).filter(isNum));
  const avgRoiPct = avg(ranked.map((o) => o.roiPct!).filter(isNum));
  const preferredStrategies = countValues(historicalOwners.map((o) => o.preferredStrategy!).filter(Boolean));
  const preferredRanges = countValues(historicalOwners.map((o) => o.preferredRangeStyle!).filter(Boolean));

  return {
    top_lper_count: ranked.length,
    study_mode: "lpagent_top_lpers",
    pool_name:
      overview?.name ||
      `${overview?.tokenXSymbol || "TOKEN"}-${overview?.tokenYSymbol || "SOL"}`,
    active_position_count: signalData.activePositionCount ?? ranked.length,
    owner_count: signalData.ownerCount ?? ranked.length,
    avg_hold_hours: round(avgHold, 2),
    avg_open_pnl_pct: round(avgOpenPnlPct, 2),
    avg_fee_percent: round(avgFeePct, 2),
    avg_roi_pct: round(avgRoiPct, 2),
    best_open_pnl_pct: ranked[0] ? `${round(ranked[0].pnlPerInflowPct!, 2)}%` : null,
    scalper_count: ranked.filter((o) => (o.avgAgeHours || 0) < 1).length,
    holder_count: ranked.filter((o) => (o.avgAgeHours || 0) >= 4).length,
    preferred_strategies: preferredStrategies,
    preferred_range_styles: preferredRanges,
    top_historical_owners: (signalData.topHistoricalOwners || []).slice(0, 3),
    suggested_style: signalData.suggestedStyle || null,
  };
}

function countValues(values: string[]): Record<string, number> {
  const map = new Map<string, number>();
  for (const value of values) {
    map.set(value, (map.get(value) || 0) + 1);
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

function avg(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function round(value: number, digits = 2): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

function isNum(value: number): boolean {
  return Number.isFinite(Number(value));
}

export async function studyTopLPers({ pool_address, limit = 4 }: { pool_address: string; limit?: number }): Promise<{
  pool: string;
  pool_name: string;
  message: string;
  patterns?: PatternResult;
  lpers?: LperResult[];
}> {
  const [poolRes, signalRes] = await Promise.all([
    fetchTopLp(pool_address),
    fetchStudyTopLp(pool_address),
  ]);

  const poolData: PoolData = poolRes;
  const signalData = signalRes as SignalData;

  const topLpers: Owner[] = Array.isArray(poolData.topLpers) ? poolData.topLpers : [];
  const historicalOwners: HistoricalOwner[] = Array.isArray(poolData.historicalOwners) ? poolData.historicalOwners : [];
  const ranked = topLpers.slice(0, Math.max(1, limit));

  if (!ranked.length) {
    return {
      pool: pool_address,
      pool_name: poolData.overview?.name || "Unknown pool",
      message: "No LPAgent top LPer data found for this pool yet.",
      lpers: [],
    };
  }

  const historicalMap = new Map<string, HistoricalOwner>(
    historicalOwners.map((owner) => [owner.owner, owner])
  );

  const lpers: LperResult[] = ranked.map((owner) => {
    const history = historicalMap.get(owner.owner);
    return {
      owner: owner.owner,
      owner_short: owner.ownerShort || `${owner.owner.slice(0, 8)}...`,
      signal_tags: [
        history?.preferredStrategy ? `strategy:${history.preferredStrategy}` : null,
        history?.preferredRangeStyle ? `range:${history.preferredRangeStyle}` : null,
      ].filter((tag): tag is string => typeof tag === "string"),
      summary: {
        total_positions: owner.totalLp || history?.topPositions?.length || 0,
        avg_hold_hours: round(owner.avgAgeHours ?? history?.avgHoldHours ?? 0, 2),
        avg_open_pnl_pct: round(owner.pnlPerInflowPct ?? history?.avgPnlPct ?? 0, 2),
        avg_fee_per_tvl_24h_pct: round(owner.feePercent ?? history?.avgFeePercent ?? 0, 2),
        total_pnl_usd: round(owner.totalPnlUsd ?? history?.roiPct ?? 0, 2),
        total_balance_usd: round(owner.totalInflowUsd ?? history?.avgHoldHours ?? 0, 2),
        avg_range_width_pct: null!,
        avg_distance_to_active_pct: null!,
        win_rate: round((owner.winRatePct ?? 0) / 100, 2),
        roi: round((owner.roiPct ?? 0) / 100, 4),
        fee_pct_of_capital: round((owner.feePctOfCapital ?? 0) / 100, 2),
        preferred_strategy: history?.preferredStrategy || "unknown",
        preferred_range_style: history?.preferredRangeStyle || "unknown",
      },
          positions: Array.isArray(history?.topPositions)
        ? history!.topPositions.map((position) => ({
            pool: pool_address,
            pair: poolData.overview?.name || "Unknown pool",
            hold_hours: round(position.ageHours ?? 0, 2),
            pnl_usd: round(position.pnlUsd ?? 0, 2),
            pnl_pct: round(position.pnlPct ?? 0, 2),
            fee_usd: round(position.feeUsd ?? 0, 2),
            in_range_pct: position.inRange == null ? 0 : position.inRange ? 100 : 0,
            strategy: position.strategy || "unknown",
            closed_reason: position.rangeStyle || "unknown",
            balance_usd: round(position.inputValue ?? 0, 2),
            fee_per_tvl_24h_pct: round(position.feePercent ?? 0, 2),
            range_width_pct: Number(position.widthBins ?? 0),
            distance_to_active_pct: 0,
            lower_bin_id: position.lowerBinId ?? null,
            upper_bin_id: position.upperBinId ?? null,
          }))
        : [],
    };
  });

  const patterns = buildPatterns(ranked, historicalOwners, signalData, poolData.overview || {});

  return {
    pool: pool_address,
    pool_name:
      poolData.overview?.name ||
      `${poolData.overview?.tokenXSymbol || "TOKEN"}-${poolData.overview?.tokenYSymbol || "SOL"}`,
    message:
      "LPAgent-backed top LP study from Agent Meridian 30m cached owner aggregates plus owner historical positions.",
    patterns,
    lpers,
  };
}
