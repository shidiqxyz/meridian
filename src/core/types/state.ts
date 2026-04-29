import type { StrategyConfig } from "./config";

export interface RecentEvent {
  action: string;
  position?: string;
  pool_name?: string;
  timestamp: string;
  note?: string;
  reason?: string;
}

export interface Position {
  position: string;
  pool: string;
  pool_name: string;
  strategy: string;
  instruction?: string;
  base_mint?: string | null;
  bin_range: {
    bins_below: number;
    bins_above: number;
  };
  amount_sol: number;
  amount_x: number;
  active_bin_at_deploy: number | null;
  bin_step: number;
  volatility: number;
  fee_tvl_ratio: number;
  organic_score: number;
  initial_value_usd: number;
  initial_fee_tvl_24h?: number;
  signal_snapshot: Record<string, unknown> | null;
  deployed_at: string;
  out_of_range_since: string | null;
  last_claim_at: string | null;
  total_fees_claimed_usd: number;
  rebalance_count: number;
  closed: boolean;
  closed_at: string | null;
  notes: string[];
  peak_pnl_pct: number;
  pending_peak_pnl_pct: number | null;
  pending_peak_started_at: string | null;
  pending_trailing_current_pnl_pct: number | null;
  pending_trailing_peak_pnl_pct: number | null;
  pending_trailing_drop_pct: number | null;
  pending_trailing_started_at: string | null;
  confirmed_trailing_exit_reason: string | null;
  confirmed_trailing_exit_until: string | null;
  trailing_active: boolean;
}

export interface State {
  positions: Record<string, Position>;
  recentEvents: RecentEvent[];
  lastUpdated: string | null;
  lastBriefingDate?: string | null;
}

export interface PerformanceRecord {
  position: string;
  pool: string;
  pool_name: string;
  strategy: string;
  bin_range: number | { bins_below: number; bins_above: number };
  bin_step: number;
  volatility: number;
  fee_tvl_ratio: number;
  organic_score: number;
  amount_sol: number;
  fees_earned_usd: number;
  fees_earned_sol?: number;
  final_value_usd: number;
  initial_value_usd: number;
  minutes_in_range: number;
  minutes_held: number;
  close_reason: string;
  pnl_usd: number;
  pnl_pct: number;
  range_efficiency: number;
  recorded_at: string;
  deployed_at?: string;
  base_mint?: string;
}

export interface Lesson {
  id: number;
  rule: string;
  tags: string[];
  outcome: string;
  sourceType: string;
  confidence?: number;
  context?: string;
  pnl_pct?: number;
  fees_earned_usd?: number;
  initial_value_usd?: number;
  range_efficiency?: number;
  close_reason?: string;
  pool?: string;
  created_at: string;
  pinned?: boolean;
  role?: string | null;
}

export interface LessonsData {
  lessons: Lesson[];
  performance: PerformanceRecord[];
}

export interface DeployRecord {
  deployed_at: string;
  closed_at: string | null;
  pnl_pct: number | null;
  pnl_usd: number | null;
  range_efficiency: number | null;
  minutes_held: number | null;
  fees_earned_usd: number | null;
  fees_earned_sol: number | null;
  fee_earned_pct: number | null;
  close_reason: string | null;
  strategy: string | null;
  volatility: number | null;
}

export interface PoolSnapshot {
  ts: string;
  position?: string;
  pnl_pct?: number | null;
  pnl_usd?: number | null;
  in_range?: boolean | null;
  unclaimed_fees_usd?: number | null;
  minutes_out_of_range?: number | null;
  age_minutes?: number | null;
}

export interface PoolMemoryEntry {
  name: string;
  base_mint: string | null;
  deploys: DeployRecord[];
  total_deploys: number;
  avg_pnl_pct: number;
  win_rate: number;
  adjusted_win_rate: number;
  adjusted_win_rate_sample_count: number;
  last_deployed_at: string | null;
  last_outcome: string | null;
  notes: Array<{ note: string; added_at: string }>;
  snapshots?: PoolSnapshot[];
  cooldown_until?: string | null;
  cooldown_reason?: string | null;
  base_mint_cooldown_until?: string | null;
  base_mint_cooldown_reason?: string | null;
}

export interface PoolMemory {
  [poolAddress: string]: PoolMemoryEntry;
}

export interface EvolveResult {
  changes: Record<string, number>;
  rationale: Record<string, string>;
}
