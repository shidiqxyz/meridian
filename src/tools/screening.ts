import { config } from "../core/config/config.js";
import { isBlacklisted } from "../services/token-blacklist.js";
import { isDevBlocked, getBlockedDevs } from "../services/dev-blocklist.js";
import { log } from "../core/logger/logger.js";
import { isBaseMintOnCooldown, isPoolOnCooldown } from "../core/state/pool-memory.js";
import { confirmIndicatorPreset, type IndicatorResult } from "./chart-indicators.js";
import { getAgentMeridianBase, getAgentMeridianHeaders } from "./agent-meridian.js";

const DATAPI_JUP = "https://datapi.jup.ag/v1";
const POOL_DISCOVERY_BASE = "https://pool-discovery-api.datapi.meteora.ag";
const PVP_SHORTLIST_LIMIT = 2;
const PVP_RIVAL_LIMIT = 2;
const PVP_MIN_ACTIVE_TVL = 5_000;
const PVP_MIN_HOLDERS = 500;
const PVP_MIN_GLOBAL_FEES_SOL = 30;

interface AssetSearchResult {
  id?: string;
  name?: string;
  symbol?: string;
  liquidity?: number;
  holderCount?: number;
  fees?: number;
  dev?: string | null;
}

interface DiscoveryToken {
  symbol?: string;
  mint?: string;
  address?: string;
  organic_score?: number;
  warnings?: unknown[];
  dev?: string | null;
}

export interface PoolData {
  pool?: string;
  pool_address?: string;
  name?: string;
  base?: DiscoveryToken & { organic?: number; warnings?: number };
  quote?: DiscoveryToken;
  pool_type?: string;
  bin_step?: number | null;
  fee_pct?: number | null;
  active_tvl?: number;
  fee_window?: number;
  volume_window?: number;
  fee_active_tvl_ratio?: number;
  volatility?: number | null;
  holders?: number;
  mcap?: number;
  organic_score?: number;
  token_age_hours?: number | null;
  dev?: string | null;
  active_positions?: number;
  active_pct?: number | null;
  open_positions?: number;
  discord_signal?: boolean;
  discord_signal_count?: number;
  discord_signal_seen_count?: number;
  discord_signal_last_seen_at?: string | null;
  price?: number | null;
  price_change_pct?: number | null;
  price_trend?: string | null;
  min_price?: number | null;
  max_price?: number | null;
  volume_change_pct?: number | null;
  fee_change_pct?: number | null;
  swap_count?: number;
  unique_traders?: number;
  is_pvp?: boolean;
  pvp_risk?: string;
  pvp_symbol?: string;
  pvp_rival_name?: string;
  pvp_rival_mint?: string;
  pvp_rival_pool?: string;
  pvp_rival_tvl?: number;
  pvp_rival_holders?: number;
  pvp_rival_fees?: number;
  risk_level?: number | null;
  bundle_pct?: number | null;
  sniper_pct?: number | null;
  suspicious_pct?: number | null;
  new_wallet_pct?: number | null;
  smart_money_buy?: boolean;
  dev_sold_all?: boolean;
  dev_buying_more?: boolean;
  dex_boost?: boolean;
  dex_screener_paid?: boolean;
  is_honeypot?: boolean;
  is_rugpull?: boolean;
  is_wash?: boolean;
  tags?: string[];
  kol_in_clusters?: boolean;
  top_cluster_trend?: string | null;
  top_cluster_hold_pct?: number | null;
  price_vs_ath_pct?: number | null;
  ath?: number | null;
  indicator_confirmation?: IndicatorResult | null;
  score?: number;
  [key: string]: unknown;
}

interface CandidateResult {
  total?: number;
  pools?: PoolData[];
  candidates?: PoolData[];
}

interface FilteredReason {
  name: string;
  reason: string;
}

function safeNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function normalizeSymbol(symbol: unknown): string {
  return String(symbol || "").trim().toUpperCase();
}

export function scoreCandidate(pool: PoolData): number {
  const feeTvl = Number(pool.fee_active_tvl_ratio || 0);
  const organic = Number(pool.organic_score || 0);
  const volume = Number(pool.volume_window || 0);
  const holders = Number(pool.holders || 0);
  return feeTvl * 1000 + organic * 10 + volume / 100 + holders / 100;
}

async function fetchDiscordSignalCandidates(): Promise<Array<{ discovery_pool?: any; source_count?: number; seen_count?: number; first_seen_at?: string; last_seen_at?: string }>> {
  const response = await fetch(`${getAgentMeridianBase()}/signals/discord/candidates`, {
    headers: getAgentMeridianHeaders(),
  });
  if (!response.ok) throw new Error(`discord signal candidates ${response.status}`);
  const data = await response.json();
  return Array.isArray(data?.candidates) ? data.candidates : [];
}

async function searchAssetsBySymbol(symbol: string): Promise<AssetSearchResult[]> {
  const response = await fetch(`${DATAPI_JUP}/assets/search?query=${encodeURIComponent(symbol)}`);
  if (!response.ok) throw new Error(`assets/search ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : data ? [data] : [];
}

async function findRivalPool(mint: string): Promise<any | null> {
  const url = `https://dlmm.datapi.meteora.ag/pools?query=${encodeURIComponent(mint)}&sort_by=${encodeURIComponent("tvl:desc")}&filter_by=${encodeURIComponent(`tvl>${PVP_MIN_ACTIVE_TVL}`)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`rival pool search ${response.status}`);
  const data = await response.json();
  const pools = Array.isArray(data?.data) ? data.data : [];
  return pools.find((pool: any) => pool?.token_x?.address === mint || pool?.token_y?.address === mint) || null;
}

async function enrichPvpRisk(pools: PoolData[]): Promise<void> {
  const shortlist = [...pools].sort((a, b) => scoreCandidate(b) - scoreCandidate(a)).slice(0, PVP_SHORTLIST_LIMIT);
  const symbolCache = new Map<string, AssetSearchResult[]>();

  await Promise.all(shortlist.map(async (pool) => {
    const symbol = normalizeSymbol(pool.base?.symbol);
    const ownMint = pool.base?.mint;
    if (!symbol || !ownMint) return;

    let assets = symbolCache.get(symbol);
    if (!assets) {
      assets = await searchAssetsBySymbol(symbol).catch(() => []);
      symbolCache.set(symbol, assets);
    }

    const rivals = assets
      .filter((asset) => normalizeSymbol(asset.symbol) === symbol && asset.id && asset.id !== ownMint)
      .sort((a, b) => Number(b.liquidity || 0) - Number(a.liquidity || 0))
      .slice(0, PVP_RIVAL_LIMIT);

    for (const rival of rivals) {
      const rivalHolders = Number(rival.holderCount || 0);
      const rivalFees = Number(rival.fees || 0);
      if (rivalHolders < PVP_MIN_HOLDERS || rivalFees < PVP_MIN_GLOBAL_FEES_SOL || !rival.id) continue;

      const rivalPool = await findRivalPool(rival.id).catch(() => null);
      if (!rivalPool) continue;

      pool.is_pvp = true;
      pool.pvp_risk = "high";
      pool.pvp_symbol = pool.base?.symbol || symbol;
      pool.pvp_rival_name = rival.name || pool.pvp_symbol;
      pool.pvp_rival_mint = rival.id;
      pool.pvp_rival_pool = rivalPool.address;
      pool.pvp_rival_tvl = Math.round(Number(rivalPool.tvl || 0));
      pool.pvp_rival_holders = rivalHolders;
      pool.pvp_rival_fees = Math.round(rivalFees);
      break;
    }
  }));
}

function condensePool(pool: any): PoolData {
  const activeTvl = safeNumber(pool.active_tvl) || 0;
  const feeWindow = safeNumber(pool.fee) || 0;
  return {
    pool: pool.pool_address,
    pool_address: pool.pool_address,
    name: pool.name,
    base: {
      symbol: pool.token_x?.symbol,
      mint: pool.token_x?.address,
      address: pool.token_x?.address,
      organic_score: safeNumber(pool.token_x?.organic_score),
      organic: Math.round(safeNumber(pool.token_x?.organic_score) || 0),
      warnings: Array.isArray(pool.token_x?.warnings) ? pool.token_x.warnings.length : 0,
      dev: typeof pool.token_x?.dev === "string" ? pool.token_x.dev : null,
    },
    quote: {
      symbol: pool.token_y?.symbol,
      mint: pool.token_y?.address,
      address: pool.token_y?.address,
    },
    pool_type: pool.pool_type,
    bin_step: safeNumber(pool.dlmm_params?.bin_step) ?? null,
    fee_pct: safeNumber(pool.fee_pct) ?? null,
    active_tvl: Math.round(activeTvl),
    fee_window: Math.round(feeWindow),
    volume_window: Math.round(safeNumber(pool.volume) || 0),
    fee_active_tvl_ratio: safeNumber(pool.fee_active_tvl_ratio) && Number(pool.fee_active_tvl_ratio) > 0
      ? Number(Number(pool.fee_active_tvl_ratio).toFixed(4))
      : activeTvl > 0
        ? Number((((feeWindow / activeTvl) * 100)).toFixed(4))
        : 0,
    volatility: safeNumber(pool.volatility) != null ? Number(Number(pool.volatility).toFixed(2)) : null,
    holders: safeNumber(pool.base_token_holders),
    mcap: Math.round(safeNumber(pool.base_token_market_cap) || 0),
    organic_score: Math.round(safeNumber(pool.base_token_organic_score) || 0),
    token_age_hours: safeNumber(pool.token_x_created_at) ? Math.floor((Date.now() - Number(pool.token_x_created_at)) / 3_600_000) : null,
    dev: typeof pool.token_x?.dev === "string" ? pool.token_x.dev : null,
    active_positions: safeNumber(pool.active_positions),
    active_pct: safeNumber(pool.active_positions_pct) != null ? Number((Number(pool.active_positions_pct) * 100).toFixed(2)) : null,
    open_positions: safeNumber(pool.open_positions),
    discord_signal: Boolean(pool.discord_signal),
    discord_signal_count: safeNumber(pool.discord_signal_count) || 0,
    discord_signal_seen_count: safeNumber(pool.discord_signal_seen_count) || 0,
    discord_signal_last_seen_at: pool.discord_signal_last_seen_at || null,
    price: safeNumber(pool.pool_price) ?? null,
    price_change_pct: safeNumber(pool.pool_price_change_pct) != null ? Number((Number(pool.pool_price_change_pct) * 10).toFixed(1)) : null,
    price_trend: typeof pool.price_trend === "string" ? pool.price_trend : null,
    min_price: safeNumber(pool.min_price) ?? null,
    max_price: safeNumber(pool.max_price) ?? null,
    volume_change_pct: safeNumber(pool.volume_change_pct) != null ? Number((Number(pool.volume_change_pct) * 10).toFixed(1)) : null,
    fee_change_pct: safeNumber(pool.fee_change_pct) != null ? Number((Number(pool.fee_change_pct) * 10).toFixed(1)) : null,
    swap_count: safeNumber(pool.swap_count),
    unique_traders: safeNumber(pool.unique_traders),
  };
}

function pushFilteredReason(list: FilteredReason[], pool: PoolData, reason: string): void {
  list.push({
    name: pool.name || `${pool.base?.symbol || "?"}-${pool.quote?.symbol || "?"}`,
    reason,
  });
}

export async function discoverPools({ page_size = 50 }: { page_size?: number } = {}): Promise<CandidateResult> {
  const screening = config.screening;
  const filters = [
    "base_token_has_critical_warnings=false",
    "quote_token_has_critical_warnings=false",
    screening.excludeHighSupplyConcentration ? "base_token_has_high_supply_concentration=false" : null,
    "base_token_has_high_single_ownership=false",
    "pool_type=dlmm",
    `base_token_market_cap>=${screening.minMcap}`,
    `base_token_market_cap<=${screening.maxMcap}`,
    `base_token_holders>=${screening.minHolders}`,
    `volume>=${screening.minVolume}`,
    `tvl>=${screening.minTvl}`,
    screening.maxTvl != null ? `tvl<=${screening.maxTvl}` : null,
    `dlmm_bin_step>=${screening.minBinStep}`,
    `dlmm_bin_step<=${screening.maxBinStep}`,
    `fee_active_tvl_ratio>=${screening.minFeeActiveTvlRatio}`,
    `base_token_organic_score>=${screening.minOrganic}`,
    `quote_token_organic_score>=${screening.minQuoteOrganic}`,
  ].filter(Boolean).join("&&");

  const useServerDiscovery = Boolean(config.api.publicApiKey);
  const url = useServerDiscovery
    ? `${getAgentMeridianBase()}/discovery/pools?page_size=${page_size}&filter_by=${encodeURIComponent(filters)}&timeframe=${screening.timeframe}&category=${screening.category}`
    : `${POOL_DISCOVERY_BASE}/pools?page_size=${page_size}&filter_by=${encodeURIComponent(filters)}&timeframe=${screening.timeframe}&category=${screening.category}`;

  const response = await fetch(url, {
    headers: useServerDiscovery ? getAgentMeridianHeaders() : {},
  });
  if (!response.ok) throw new Error(`Pool Discovery API error: ${response.status} ${response.statusText}`);

  const data = await response.json();
  let rawPools = Array.isArray(data?.data) ? data.data : [];

  if (config.screening.useDiscordSignals) {
    const signalCandidates = await fetchDiscordSignalCandidates().catch((error: unknown) => {
      log("screening", `Discord signal fetch failed: ${(error as Error).message}`);
      return [];
    });

    const signalPools = signalCandidates
      .map((candidate) => {
        const pool = candidate.discovery_pool;
        if (!pool?.pool_address) return null;
        return {
          ...pool,
          discord_signal: true,
          discord_signal_count: candidate.source_count || 1,
          discord_signal_seen_count: candidate.seen_count || 1,
          discord_signal_first_seen_at: candidate.first_seen_at || null,
          discord_signal_last_seen_at: candidate.last_seen_at || null,
        };
      })
      .filter(Boolean);

    if (config.screening.discordSignalMode === "only") {
      rawPools = signalPools;
    } else if (signalPools.length > 0) {
      const byPool = new Map<string, any>(rawPools.map((pool: any) => [String(pool.pool_address), pool]));
      for (const signalPool of signalPools) {
        byPool.set(String(signalPool.pool_address), {
          ...(byPool.get(String(signalPool.pool_address)) || {}),
          ...signalPool,
        });
      }
      rawPools = Array.from(byPool.values());
    }
  }

  let pools = rawPools.map(condensePool).filter((pool: PoolData) => {
    if (pool.base?.mint && isBlacklisted(pool.base.mint)) return false;
    if (pool.dev && isDevBlocked(pool.dev)) return false;
    return true;
  });

  const blockedDevs = getBlockedDevs();
  if (Object.keys(blockedDevs).length > 0) {
    const missingDevPools = pools.filter((pool: PoolData) => !pool.dev && pool.base?.mint);
    if (missingDevPools.length > 0) {
      const devResults = await Promise.allSettled(
        missingDevPools.map(async (pool: PoolData) => {
          const response = await fetch(`${DATAPI_JUP}/assets/search?query=${pool.base?.mint}`);
          const data = response.ok ? await response.json() : null;
          const token = Array.isArray(data) ? data[0] : data;
          return { pool: pool.pool, dev: token?.dev || null };
        }),
      );

      const devMap = new Map<string, string | null>();
      for (const result of devResults) {
        if (result.status === "fulfilled" && result.value.pool) {
          devMap.set(String(result.value.pool), result.value.dev);
        }
      }

      pools = pools.filter((pool: PoolData) => {
        const dev = pool.pool ? devMap.get(pool.pool) : null;
        if (dev) pool.dev = dev;
        return !(dev && isDevBlocked(dev));
      });
    }
  }

  return {
    total: safeNumber(data?.total),
    pools,
  };
}

export async function pickBestCandidate(): Promise<PoolData | null> {
  const { candidates } = await getTopCandidates({ limit: 3 });
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
}

export async function getTopCandidates({ limit = 3 }: { limit?: number } = {}): Promise<{ total_screened?: number; candidates: PoolData[]; filtered_examples?: FilteredReason[] }> {
  const discovered = await discoverPools({ page_size: 50 });
  const pools = discovered.pools || [];
  const filteredOut: FilteredReason[] = [];

  const { getMyPositions } = await import("./dlmm.js");
  const { positions } = await getMyPositions();
  const occupiedPools = new Set(positions.map((position: any) => position.pool));
  const occupiedMints = new Set(positions.map((position: any) => position.base_mint).filter(Boolean));

  const eligible = pools
    .filter((pool) => {
      if (pool.pool && occupiedPools.has(pool.pool)) {
        pushFilteredReason(filteredOut, pool, "already have an open position in this pool");
        return false;
      }
      if (pool.base?.mint && occupiedMints.has(pool.base.mint)) {
        pushFilteredReason(filteredOut, pool, "already holding this base token in another pool");
        return false;
      }
      if (pool.pool && isPoolOnCooldown(pool.pool)) {
        pushFilteredReason(filteredOut, pool, "pool cooldown active");
        return false;
      }
      if (pool.base?.mint && isBaseMintOnCooldown(pool.base.mint)) {
        pushFilteredReason(filteredOut, pool, "token cooldown active");
        return false;
      }
      return true;
    })
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, limit);

  if (config.screening.avoidPvpSymbols && eligible.length > 0) {
    await enrichPvpRisk(eligible);
    if (config.screening.blockPvpSymbols) {
      const beforePvp = eligible.length;
      const kept = eligible.filter((pool) => !pool.is_pvp);
      eligible.filter((pool) => pool.is_pvp).forEach((pool) => pushFilteredReason(filteredOut, pool, "PVP hard filter"));
      eligible.splice(0, eligible.length, ...kept);
      if (eligible.length < beforePvp) {
        log("screening", `PVP hard filter removed ${beforePvp - eligible.length} pool(s)`);
      }
    }
  }

  if (eligible.length > 0) {
    const { getAdvancedInfo, getPriceInfo, getClusterList, getRiskFlags } = await import("./okx.js");
    const enrichments = await Promise.allSettled(
      eligible.map(async (pool) => {
        const mint = pool.base?.mint;
        if (!mint) return null;
        const [advanced, price, clusters, risk] = await Promise.all([
          getAdvancedInfo(mint).catch(() => null),
          getPriceInfo(mint).catch(() => null),
          getClusterList(mint).catch(() => null),
          getRiskFlags(mint).catch(() => null),
        ]);
        return { advanced, price, clusters, risk };
      }),
    );

    for (let index = 0; index < eligible.length; index += 1) {
      const result = enrichments[index];
      if (result.status !== "fulfilled" || !result.value) continue;
      const { advanced, price, clusters, risk } = result.value;
      const advancedValue = advanced?.value;
      const priceValue = price?.value;
      const clusterValue = clusters?.value ?? [];
      const riskValue = risk?.value;

      if (advancedValue) {
        eligible[index].risk_level = advancedValue.risk_level ?? null;
        eligible[index].bundle_pct = advancedValue.bundle_pct ?? null;
        eligible[index].sniper_pct = advancedValue.sniper_pct ?? null;
        eligible[index].suspicious_pct = advancedValue.suspicious_pct ?? null;
        eligible[index].new_wallet_pct = advancedValue.new_wallet_pct ?? null;
        eligible[index].smart_money_buy = Boolean(advancedValue.smart_money_buy);
        eligible[index].dev_sold_all = Boolean(advancedValue.dev_sold_all);
        eligible[index].dev_buying_more = Boolean(advancedValue.dev_buying_more);
        eligible[index].dex_boost = Boolean(advancedValue.dex_boost);
        eligible[index].dex_screener_paid = Boolean(advancedValue.dex_screener_paid);
        eligible[index].is_honeypot = Boolean(advancedValue.is_honeypot);
        eligible[index].is_wash = Boolean(advancedValue.is_wash);
        eligible[index].tags = advancedValue.tags ?? [];
      }
      if (riskValue) {
        eligible[index].is_rugpull = riskValue.is_rugpull;
        eligible[index].is_wash = riskValue.is_wash;
      }
      if (priceValue) {
        eligible[index].price_vs_ath_pct = priceValue.price_vs_ath_pct ?? null;
        eligible[index].ath = priceValue.ath ?? null;
      }
      if (clusterValue.length > 0) {
        eligible[index].kol_in_clusters = clusterValue.some((cluster) => Boolean(cluster.has_kol));
        eligible[index].top_cluster_trend = clusterValue[0]?.trend ?? null;
        eligible[index].top_cluster_hold_pct = clusterValue[0]?.holding_pct ?? null;
      }
    }

    const beforeWash = eligible.length;
    eligible.splice(0, eligible.length, ...eligible.filter((pool) => {
      if (pool.is_wash) {
        pushFilteredReason(filteredOut, pool, "wash trading flagged");
        return false;
      }
      return true;
    }));
    if (eligible.length < beforeWash) {
      log("screening", `Wash-trading filter removed ${beforeWash - eligible.length} pool(s)`);
    }

    const athFilter = config.screening.athFilterPct;
    if (athFilter != null) {
      const threshold = 100 + athFilter;
      const beforeAth = eligible.length;
      eligible.splice(0, eligible.length, ...eligible.filter((pool) => {
        if (pool.price_vs_ath_pct == null) return true;
        if (pool.price_vs_ath_pct > threshold) {
          pushFilteredReason(filteredOut, pool, `${pool.price_vs_ath_pct}% of ATH > ${threshold}% limit`);
          return false;
        }
        return true;
      }));
      if (eligible.length < beforeAth) {
        log("screening", `ATH filter removed ${beforeAth - eligible.length} pool(s)`);
      }
    }
  }

  if (config.indicators.enabled && eligible.length > 0) {
    const confirmations = await Promise.all(
      eligible.map(async (pool) => {
        const poolKey = pool.pool || "";
        try {
          if (!pool.base?.mint) throw new Error("missing base mint");
          const confirmation = await confirmIndicatorPreset({
            mint: pool.base.mint,
            side: "entry",
          });
          return [poolKey, confirmation] as const;
        } catch (error: unknown) {
          return [poolKey, {
            enabled: true,
            confirmed: true,
            skipped: true,
            reason: `Indicator confirmation unavailable: ${(error as Error).message}`,
            intervals: [],
          } satisfies IndicatorResult] as const;
        }
      }),
    );

    const confirmationByPool = new Map<string, IndicatorResult>(confirmations);
    const beforeIndicators = eligible.length;
    eligible.splice(0, eligible.length, ...eligible.filter((pool) => {
      const poolKey = pool.pool || "";
      const confirmation = confirmationByPool.get(poolKey) || null;
      pool.indicator_confirmation = confirmation;
      if (!confirmation || confirmation.confirmed) return true;
      pushFilteredReason(filteredOut, pool, `indicator reject: ${confirmation.reason}`);
      return false;
    }));
    if (eligible.length < beforeIndicators) {
      log("screening", `Indicator confirmation removed ${beforeIndicators - eligible.length} candidate(s)`);
    }
  }

  eligible.forEach((pool) => {
    pool.score = scoreCandidate(pool);
  });

  return {
    candidates: eligible,
    total_screened: pools.length,
    filtered_examples: filteredOut.slice(0, 3),
  };
}

export async function getPoolDetail({ pool_address, timeframe = "5m" }: { pool_address: string; timeframe?: string }): Promise<any> {
  const useServerDiscovery = Boolean(config.api.publicApiKey);
  const url = useServerDiscovery
    ? `${getAgentMeridianBase()}/discovery/pools/${pool_address}?timeframe=${encodeURIComponent(timeframe)}`
    : `${POOL_DISCOVERY_BASE}/pools?page_size=1&filter_by=${encodeURIComponent(`pool_address=${pool_address}`)}&timeframe=${encodeURIComponent(timeframe)}`;

  const response = await fetch(url, {
    headers: useServerDiscovery ? getAgentMeridianHeaders() : {},
  });
  if (!response.ok) throw new Error(`Pool detail API error: ${response.status} ${response.statusText}`);

  const data = await response.json();
  const pool = useServerDiscovery ? data : (Array.isArray(data?.data) ? data.data[0] : null);
  if (!pool) throw new Error(`Pool ${pool_address} not found`);
  return pool;
}
