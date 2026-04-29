import crypto from "crypto";
import { config } from "../core/config/config.js";

const BASE = "https://web3.okx.com";
const CHAIN_SOLANA = "501";
const PUBLIC_HEADERS = { "Ok-Access-Client-type": "agent-cli" } as const;
const OKX_API_KEY = process.env.OKX_API_KEY || process.env.OK_ACCESS_KEY || "";
const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY || process.env.OK_ACCESS_SECRET || "";
const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE || process.env.OK_ACCESS_PASSPHRASE || "";
const OKX_PROJECT_ID = process.env.OKX_PROJECT_ID || process.env.OK_ACCESS_PROJECT || "";

type HeaderMap = Record<string, string>;

export interface RiskFlagsResult {
  is_rugpull: boolean;
  is_wash: boolean;
  risk_level: number | null;
  source: string;
}

export interface RiskFlagsResponse {
  status: "fulfilled";
  value: RiskFlagsResult;
}

export interface AdvancedInfo {
  risk_level?: number | null;
  bundle_pct?: number | null;
  sniper_pct?: number | null;
  suspicious_pct?: number | null;
  new_wallet_pct?: number | null;
  smart_money_buy?: boolean;
  dev_sold_all?: boolean;
  dev_buying_more?: boolean;
  is_honeypot?: boolean;
  is_wash?: boolean;
  low_liquidity?: boolean;
  dex_boost?: boolean;
  dex_screener_paid?: boolean;
  tags?: string[];
  top10_holders_pct?: number | null;
}

export interface Cluster {
  holdingPercent?: number | null;
  trend?: string | null;
  avgHoldDays?: number | null;
  has_kol?: boolean;
  holding_pct?: number | null;
}

export interface PriceInfo {
  price?: number | null;
  ath?: number | null;
  price_vs_ath_pct?: number | null;
}

interface ServerEnrichment {
  advanced?: AdvancedInfo | null;
  clusters?: Cluster[] | null;
  price?: PriceInfo | null;
  risk?: RiskFlagsResult | null;
}

interface OkxResponse {
  code: string | number;
  msg?: string;
  data?: any;
}

function pct(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function int(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Number.parseInt(String(value), 10);
  return Number.isFinite(num) ? num : null;
}

function hasAuth(): boolean {
  return Boolean(OKX_API_KEY && OKX_SECRET_KEY && OKX_PASSPHRASE && !/enter your passphrase here/i.test(OKX_PASSPHRASE));
}

function buildAuthHeaders(method: string, path: string, body = ""): HeaderMap {
  const timestamp = new Date().toISOString();
  const prehash = `${timestamp}${method.toUpperCase()}${path}${body}`;
  const sign = crypto.createHmac("sha256", OKX_SECRET_KEY).update(prehash).digest("base64");

  const headers: HeaderMap = {
    "OK-ACCESS-KEY": OKX_API_KEY,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
    "OK-ACCESS-TIMESTAMP": timestamp,
  };
  if (OKX_PROJECT_ID) headers["OK-ACCESS-PROJECT"] = OKX_PROJECT_ID;
  return headers;
}

async function okxRequest(method: string, path: string, body: unknown = null): Promise<any> {
  const bodyText = body == null ? "" : JSON.stringify(body);
  const headers: HeaderMap = hasAuth()
    ? { ...buildAuthHeaders(method, path, bodyText), ...(body != null ? { "Content-Type": "application/json" } : {}) }
    : { ...PUBLIC_HEADERS, ...(body != null ? { "Content-Type": "application/json" } : {}) };

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body != null ? { body: bodyText } : {}),
  });
  if (!response.ok) throw new Error(`OKX API ${response.status}: ${path}`);

  const json = await response.json() as OkxResponse;
  if (String(json.code) !== "0") {
    throw new Error(`OKX error ${json.code}: ${json.msg || "unknown"}`);
  }
  return json.data;
}

async function okxGet(path: string): Promise<any> {
  return okxRequest("GET", path);
}

async function okxPost(path: string, body: unknown): Promise<any> {
  return okxRequest("POST", path, body);
}

const serverEnrichmentCache = new Map<string, { at: number; promise: Promise<ServerEnrichment | null> }>();
const SERVER_ENRICHMENT_CACHE_MS = 30_000;

function agentMeridianBaseUrl(): string {
  return String(config.api?.url || "").replace(/\/+$/, "");
}

function agentMeridianHeaders(): HeaderMap {
  const headers: HeaderMap = { accept: "application/json" };
  if (config.api?.publicApiKey) headers["x-api-key"] = config.api.publicApiKey;
  return headers;
}

export async function fetchServerOkxEnrichment(tokenAddress: string, chainIndex = CHAIN_SOLANA): Promise<ServerEnrichment | null> {
  const baseUrl = agentMeridianBaseUrl();
  if (!baseUrl) return null;

  const cacheKey = `${chainIndex}:${tokenAddress}`;
  const cached = serverEnrichmentCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SERVER_ENRICHMENT_CACHE_MS) {
    return cached.promise;
  }

  const url = `${baseUrl}/okx/enrich/${encodeURIComponent(tokenAddress)}?chainIndex=${encodeURIComponent(chainIndex)}`;
  const promise = fetch(url, { headers: agentMeridianHeaders() })
    .then(async (response) => {
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new Error(payload?.error || `Agent Meridian OKX enrichment ${response.status}`);
      }
      return payload as ServerEnrichment | null;
    })
    .catch((error) => {
      serverEnrichmentCache.delete(cacheKey);
      throw error;
    });

  serverEnrichmentCache.set(cacheKey, { at: Date.now(), promise });
  return promise;
}

function isAffirmative(label: unknown): boolean {
  return typeof label === "string" && label.trim().toLowerCase() === "yes";
}

function collectRiskEntries(section: any): any[] {
  if (!section || typeof section !== "object") return [];
  return [
    ...(Array.isArray(section.highRiskList) ? section.highRiskList : []),
    ...(Array.isArray(section.middleRiskList) ? section.middleRiskList : []),
    ...(Array.isArray(section.lowRiskList) ? section.lowRiskList : []),
  ];
}

export async function getRiskFlags(tokenAddress: string, chainId = CHAIN_SOLANA): Promise<RiskFlagsResponse> {
  const serverPayload = await fetchServerOkxEnrichment(tokenAddress, chainId);
  if (serverPayload?.risk) return { status: "fulfilled", value: serverPayload.risk };

  const path = `/priapi/v1/dx/market/v2/risk/new/check?chainId=${chainId}&tokenContractAddress=${tokenAddress}&t=${Date.now()}`;
  const data = await okxGet(path);
  const entries = [
    ...collectRiskEntries(data?.allAnalysis),
    ...collectRiskEntries(data?.swapAnalysis),
    ...collectRiskEntries(data?.contractAnalysis),
    ...collectRiskEntries(data?.extraAnalysis),
  ];

  const hasRisk = (riskKey: string): boolean =>
    entries.some((entry) => entry?.riskKey === riskKey && isAffirmative(entry?.newRiskLabel));

  return {
    status: "fulfilled",
    value: {
      is_rugpull: hasRisk("isLiquidityRemoval"),
      is_wash: hasRisk("isWash"),
      risk_level: int(data?.riskLevel ?? data?.riskControlLevel),
      source: "okx-risk-check",
    },
  };
}

export async function getAdvancedInfo(tokenAddress: string, chainIndex = CHAIN_SOLANA): Promise<{ status: "fulfilled"; value: AdvancedInfo | null }> {
  const serverPayload = await fetchServerOkxEnrichment(tokenAddress, chainIndex);
  if (serverPayload?.advanced) return { status: "fulfilled", value: serverPayload.advanced };

  const path = `/api/v6/dex/market/token/advanced-info?chainIndex=${chainIndex}&tokenContractAddress=${tokenAddress}`;
  const data = await okxGet(path);
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry) return { status: "fulfilled", value: null };

  const tags = Array.isArray(entry.tokenTags) ? entry.tokenTags.map((tag: unknown) => String(tag)) : [];
  return {
    status: "fulfilled",
    value: {
      risk_level: int(entry.riskControlLevel),
      bundle_pct: pct(entry.bundleHoldingPercent),
      sniper_pct: pct(entry.sniperHoldingPercent),
      suspicious_pct: pct(entry.suspiciousHoldingPercent),
      new_wallet_pct: pct(entry.newHoldingPercent),
      smart_money_buy: tags.includes("smartMoneyBuy"),
      dev_sold_all: tags.includes("devHoldingStatusSellAll"),
      dev_buying_more: tags.includes("devHoldingStatusBuy"),
      is_honeypot: tags.includes("isHoneypot"),
      is_wash: tags.includes("isWash"),
      low_liquidity: tags.includes("lowLiquidity"),
      dex_boost: tags.includes("dexBoost"),
      dex_screener_paid: tags.includes("dexScreenerPaid") || tags.includes("dsPaid"),
      tags,
    },
  };
}

export async function getClusterList(tokenAddress: string, chainIndex = CHAIN_SOLANA, limit = 5): Promise<{ status: "fulfilled"; value: Cluster[] }> {
  const serverPayload = await fetchServerOkxEnrichment(tokenAddress, chainIndex);
  if (Array.isArray(serverPayload?.clusters)) {
    return { status: "fulfilled", value: serverPayload.clusters.slice(0, limit) };
  }

  const path = `/api/v6/dex/market/token/cluster/list?chainIndex=${chainIndex}&tokenContractAddress=${tokenAddress}`;
  const data = await okxGet(path);
  const raw = Array.isArray(data) ? data : (data?.clusterList || data?.data || []);
  if (!Array.isArray(raw) || raw.length === 0) return { status: "fulfilled", value: [] };

  return {
    status: "fulfilled",
    value: raw.slice(0, limit).map((cluster: any) => ({
      holdingPercent: pct(cluster.holdingPercent),
      holding_pct: pct(cluster.holdingPercent),
      trend: cluster.trendType?.trendType ? String(cluster.trendType.trendType) : null,
      avgHoldDays: cluster.averageHoldingPeriod ? Math.round(Number(cluster.averageHoldingPeriod) / 86400) : null,
      has_kol: Boolean(cluster.hasKol || cluster.has_kol),
    })),
  };
}

export async function getPriceInfo(tokenAddress: string, chainIndex = CHAIN_SOLANA): Promise<{ status: "fulfilled"; value: PriceInfo | null }> {
  const serverPayload = await fetchServerOkxEnrichment(tokenAddress, chainIndex);
  if (serverPayload?.price) return { status: "fulfilled", value: serverPayload.price };

  const data = await okxPost("/api/v6/dex/market/price-info", {
    chainIndex,
    tokenContractAddress: tokenAddress,
  });
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry) return { status: "fulfilled", value: null };

  const price = pct(entry.price);
  const ath = pct(entry.maxPrice);
  return {
    status: "fulfilled",
    value: {
      price,
      ath,
      price_vs_ath_pct: price != null && ath != null && ath > 0 ? Number(((price / ath) * 100).toFixed(1)) : null,
    },
  };
}

export async function getFullTokenAnalysis(tokenAddress: string, chainIndex = CHAIN_SOLANA): Promise<{
  advanced?: AdvancedInfo | null;
  clusters?: Cluster[];
  price?: PriceInfo | null;
  risk?: RiskFlagsResult;
}> {
  const [advanced, clusters, price, risk] = await Promise.allSettled([
    getAdvancedInfo(tokenAddress, chainIndex),
    getClusterList(tokenAddress, chainIndex),
    getPriceInfo(tokenAddress, chainIndex),
    getRiskFlags(tokenAddress, chainIndex),
  ]);

  return {
    advanced: advanced.status === "fulfilled" ? advanced.value.value : null,
    clusters: clusters.status === "fulfilled" ? clusters.value.value : [],
    price: price.status === "fulfilled" ? price.value.value : null,
    risk: risk.status === "fulfilled" ? risk.value.value : undefined,
  };
}
