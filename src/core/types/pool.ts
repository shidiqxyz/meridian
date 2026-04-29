export interface Pool {
  name: string;
  pool: string;
  active_tvl?: number;
  tvl?: number;
  volume_24h?: number;
  volume_window?: number;
  fee_tvl_ratio?: number;
  fee_active_tvl_ratio?: number;
  organic_score?: number;
  volatility?: number;
  bin_step?: number;
  active_pct?: number;
  price?: number;
  tokens?: Array<{
    symbol: string;
    mint: string;
  }>;
}

export interface PoolDetail extends Pool {
  bin_step: number;
  active_bin?: number;
  base_fee?: number;
  min_price?: number;
  max_price?: number;
  total_range?: number;
}

export interface CandidatePool extends Pool {
  mint?: string;
  narrative?: string;
  holders?: number;
  mcap?: number;
  strategy?: string;
  bins_below?: number;
  score?: number;
}

export interface TopCandidatesResult {
  candidates: CandidatePool[];
  total: number;
  filtered?: number;
}

export interface SearchPoolsResult {
  pools: Pool[];
  total: number;
}
