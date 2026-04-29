const DATAPI_BASE = "https://datapi.jup.ag/v1";

export interface NarrativeResult {
  mint: string;
  narrative?: string | null;
  status?: string;
}

interface TokenAudit {
  mint_disabled?: boolean;
  freeze_disabled?: boolean;
  top_holders_pct?: number;
  bot_holders_pct?: number;
  dev_migrations?: number;
}

interface TokenStats {
  price_change?: number;
  buy_volume?: number;
  sell_volume?: number;
  num_organic_buyers?: number;
  num_net_buyers?: number;
}

interface TokenResult {
  mint: string;
  name?: string;
  symbol?: string;
  mcap?: number;
  price?: number;
  liquidity?: number;
  holders?: number;
  organic_score?: number;
  organic_label?: string;
  launchpad?: string;
  graduated?: boolean;
  global_fees_sol?: number;
  audit?: TokenAudit | null;
  stats_1h?: TokenStats | null;
  stats_24h_net_buyers?: number | null;
  risk_level?: number | null;
  bundle_pct?: number | null;
  sniper_pct?: number | null;
  suspicious_pct?: number | null;
  new_wallet_pct?: number | null;
  smart_money_buy?: boolean;
  tags?: string[];
  kol_in_clusters?: boolean;
  top_cluster_trend?: string | null;
  clusters?: any[];
}

interface HolderInfo {
  address?: string;
  amount?: number;
  pct?: number | null;
  sol_balance?: number | string | null;
  tags?: string[];
  is_pool?: boolean;
  funding?: {
    address?: string;
    amount?: number;
    slot?: number;
  };
}

interface SmartWalletHolding {
  name: string;
  category: string;
  address: string;
  pct: number | null;
  sol_balance: unknown;
  pnl: unknown;
}

interface HoldersResult {
  mint: string;
  total_fetched?: number;
  showing?: number;
  top_10_real_holders_pct?: number | null;
  bundlers_pct_in_top_100?: number | null;
  global_fees_sol?: number | null;
  holders?: HolderInfo[];
  smart_wallets_holding?: SmartWalletHolding[];
}

function safeNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function safeFixed(value: unknown, decimals: number): number | undefined {
  const num = safeNumber(value);
  return num == null ? undefined : Number(num.toFixed(decimals));
}

export async function getTokenNarrative({ mint }: { mint: string }): Promise<NarrativeResult> {
  const response = await fetch(`${DATAPI_BASE}/chaininsight/narrative/${mint}`);
  if (!response.ok) throw new Error(`Narrative API error: ${response.status}`);
  const data = await response.json();
  return {
    mint,
    narrative: typeof data?.narrative === "string" ? data.narrative : null,
    status: typeof data?.status === "string" ? data.status : undefined,
  };
}

export async function getTokenInfo({ query }: { query: string }): Promise<{ found: boolean; query: string; results: TokenResult[] }> {
  const response = await fetch(`${DATAPI_BASE}/assets/search?query=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(`Token search API error: ${response.status}`);

  const data = await response.json();
  const tokens = Array.isArray(data) ? data : data ? [data] : [];
  if (tokens.length === 0) {
    return { found: false, query, results: [] };
  }

  const results: TokenResult[] = tokens.slice(0, 5).map((token: any) => ({
    mint: String(token.id),
    name: typeof token.name === "string" ? token.name : undefined,
    symbol: typeof token.symbol === "string" ? token.symbol : undefined,
    mcap: safeNumber(token.mcap),
    price: safeNumber(token.usdPrice),
    liquidity: safeNumber(token.liquidity),
    holders: safeNumber(token.holderCount),
    organic_score: safeNumber(token.organicScore),
    organic_label: typeof token.organicScoreLabel === "string" ? token.organicScoreLabel : undefined,
    launchpad: typeof token.launchpad === "string" ? token.launchpad : undefined,
    graduated: Boolean(token.graduatedPool),
    global_fees_sol: safeFixed(token.fees, 2),
    audit: token.audit ? {
      mint_disabled: Boolean(token.audit.mintAuthorityDisabled),
      freeze_disabled: Boolean(token.audit.freezeAuthorityDisabled),
      top_holders_pct: safeFixed(token.audit.topHoldersPercentage, 2),
      bot_holders_pct: safeFixed(token.audit.botHoldersPercentage, 2),
      dev_migrations: safeNumber(token.audit.devMigrations),
    } : null,
    stats_1h: token.stats1h ? {
      price_change: safeFixed(token.stats1h.priceChange, 2),
      buy_volume: safeFixed(token.stats1h.buyVolume, 0),
      sell_volume: safeFixed(token.stats1h.sellVolume, 0),
      num_organic_buyers: safeNumber(token.stats1h.numOrganicBuyers),
      num_net_buyers: safeNumber(token.stats1h.numNetBuyers),
    } : null,
    stats_24h_net_buyers: safeNumber(token.stats24h?.numNetBuyers) ?? null,
  }));

  if (results[0]?.mint) {
    const { getAdvancedInfo, getClusterList } = await import("./okx.js");
    const [advanced, clusters] = await Promise.all([
      getAdvancedInfo(results[0].mint).catch(() => null),
      getClusterList(results[0].mint).catch(() => null),
    ]);

    const advancedValue = advanced?.value;
    const clusterValue = clusters?.value ?? [];
    if (advancedValue) {
      results[0].risk_level = advancedValue.risk_level ?? null;
      results[0].bundle_pct = advancedValue.bundle_pct ?? null;
      results[0].sniper_pct = advancedValue.sniper_pct ?? null;
      results[0].suspicious_pct = advancedValue.suspicious_pct ?? null;
      results[0].new_wallet_pct = advancedValue.new_wallet_pct ?? null;
      results[0].smart_money_buy = Boolean(advancedValue.smart_money_buy);
      results[0].tags = advancedValue.tags ?? [];
    }
    if (clusterValue.length > 0) {
      results[0].kol_in_clusters = clusterValue.some((cluster) => Boolean(cluster.has_kol));
      results[0].top_cluster_trend = clusterValue[0]?.trend ?? null;
      results[0].clusters = clusterValue;
    }
  }

  return { found: true, query, results };
}

export async function getTokenHolders({ mint, limit = 20 }: { mint: string; limit?: number }): Promise<HoldersResult> {
  const [holdersResponse, tokenResponse] = await Promise.all([
    fetch(`${DATAPI_BASE}/holders/${mint}?limit=100`),
    fetch(`${DATAPI_BASE}/assets/search?query=${mint}`),
  ]);
  if (!holdersResponse.ok) throw new Error(`Holders API error: ${holdersResponse.status}`);

  const holdersData = await holdersResponse.json();
  const tokenData = tokenResponse.ok ? await tokenResponse.json() : null;
  const tokenInfo = Array.isArray(tokenData) ? tokenData[0] : tokenData;
  const totalSupply = safeNumber(tokenInfo?.totalSupply ?? tokenInfo?.circSupply) ?? null;

  const holdersRaw = Array.isArray(holdersData) ? holdersData : (holdersData?.holders || holdersData?.data || []);
  const holders: HolderInfo[] = holdersRaw.slice(0, Math.min(limit, 100)).map((holder: any) => {
    const tags = (Array.isArray(holder.tags) ? holder.tags : []).map((tag: any) => String(tag?.name || tag?.id || tag));
    const isPool = tags.some((tag: string) => /pool|amm|liquidity|raydium|orca/i.test(tag));
    const pct = totalSupply
      ? (Number(holder.amount) / totalSupply) * 100
      : safeNumber(holder.percentage ?? holder.pct) ?? null;

    return {
      address: holder.address || holder.wallet,
      amount: safeNumber(holder.amount),
      pct: pct == null ? null : Number(pct.toFixed(4)),
      sol_balance: holder.solBalanceDisplay ?? holder.solBalance ?? null,
      tags: tags.length > 0 ? tags : undefined,
      is_pool: isPool || undefined,
      funding: holder.addressInfo?.fundingAddress ? {
        address: holder.addressInfo.fundingAddress,
        amount: safeNumber(holder.addressInfo.fundingAmount),
        slot: safeNumber(holder.addressInfo.fundingSlot),
      } : undefined,
    };
  });

  const realHolders = holders.filter((holder) => !holder.is_pool);
  const top10Pct = realHolders.slice(0, 10).reduce((sum, holder) => sum + (holder.pct || 0), 0);

  const { getAdvancedInfo } = await import("./okx.js");
  const advancedData = await getAdvancedInfo(mint).catch(() => null);

  const { listSmartWallets } = await import("../services/smart-wallets.js");
  const { wallets: smartWallets } = listSmartWallets();
  const smartWalletsHolding: SmartWalletHolding[] = [];

  if (smartWallets.length > 0) {
    const addresses = smartWallets.map((wallet) => wallet.address).join(",");
    const walletResponse = await fetch(`${DATAPI_BASE}/holders/${mint}?addresses=${addresses}`).catch(() => null);
    const walletData = walletResponse?.ok ? await walletResponse.json() : null;
    const walletHolders = Array.isArray(walletData) ? walletData : (walletData?.holders || walletData?.data || []);
    const smartWalletMap = new Map(smartWallets.map((wallet) => [wallet.address, wallet]));

    const matchedHolders = walletHolders
      .map((holder: any) => ({ ...holder, addr: holder.address || holder.wallet }))
      .filter((holder: any) => smartWalletMap.has(holder.addr));

    await Promise.all(matchedHolders.map(async (holder: any) => {
      const wallet = smartWalletMap.get(holder.addr);
      if (!wallet) return;

      const pct = totalSupply ? Number(((Number(holder.amount) / totalSupply) * 100).toFixed(4)) : null;
      let pnl: unknown = null;

      try {
        const pnlResponse = await fetch(`${DATAPI_BASE}/pnl-positions?address=${holder.addr}&assetId=${mint}`);
        if (pnlResponse.ok) {
          const pnlData = await pnlResponse.json();
          const position = pnlData?.[holder.addr]?.tokenPositions?.[0];
          if (position) {
            pnl = {
              balance: position.balance,
              balance_usd: position.balanceValue,
              avg_cost: position.averageCost,
              realized_pnl: position.realizedPnl,
              unrealized_pnl: position.unrealizedPnl,
              total_pnl: position.totalPnl,
              total_pnl_pct: position.totalPnlPercentage,
              buys: position.totalBuys,
              sells: position.totalSells,
              bought_value: position.boughtValue,
              sold_value: position.soldValue,
              first_active: position.firstActiveTime,
              last_active: position.lastActiveTime,
              holding_days: position.holdingPeriodInSeconds ? Math.round(position.holdingPeriodInSeconds / 86400) : null,
            };
          }
        }
      } catch {
        pnl = null;
      }

      smartWalletsHolding.push({
        name: wallet.name,
        category: wallet.category,
        address: holder.addr,
        pct,
        sol_balance: holder.solBalanceDisplay ?? holder.solBalance,
        pnl,
      });
    }));
  }

  return {
    mint,
    total_fetched: holdersRaw.length,
    showing: holders.length,
    top_10_real_holders_pct: Number(top10Pct.toFixed(2)),
    bundlers_pct_in_top_100: advancedData?.value?.bundle_pct ?? null,
    global_fees_sol: safeFixed(tokenInfo?.fees, 2) ?? null,
    holders,
    smart_wallets_holding: smartWalletsHolding,
  };
}
