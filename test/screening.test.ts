import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { config } from "../src/core/config/config.js";
import { scoreCandidate, discoverPools, getTopCandidates } from "../src/tools/screening.js";
import * as poolMemory from "../src/core/state/pool-memory.js";
import type { PoolData } from "../src/tools/screening.js";

let _blacklistedMints: string[] = [];
let _blockedDevWallets: string[] = [];
let _blockedDevs: Record<string, any> = {};

vi.mock("../src/services/token-blacklist.js", () => ({
  isBlacklisted: (mint: string) => _blacklistedMints.includes(mint),
  addToBlacklist: () => {},
  removeFromBlacklist: () => {},
  listBlacklist: () => ({ count: 0, blacklisted_tokens: [] }),
}));
vi.mock("../src/services/dev-blocklist.js", () => ({
  isDevBlocked: (dev: string) => _blockedDevWallets.includes(dev),
  getBlockedDevs: () => _blockedDevs,
  blockDev: () => {},
  unblockDev: () => {},
  listBlockedDevs: () => ({ count: 0, blocked_devs: [] }),
}));

// Helper to control mocks
function setBlacklistMocks({ isBlacklisted = false, isDevBlocked = false, blockedDevs = {} }: { isBlacklisted?: boolean; isDevBlocked?: boolean; blockedDevs?: Record<string, any> }) {
  if (isBlacklisted && !_blacklistedMints.includes("FakeMint")) _blacklistedMints.push("FakeMint");
  if (isDevBlocked && !_blockedDevWallets.includes("FakeDev")) _blockedDevWallets.push("FakeDev");
  _blockedDevs = blockedDevs;
}

function makePool(overrides: Partial<PoolData> = {}): PoolData {
  return {
    pool_address: "test-pool-" + Math.random().toString(36).slice(2, 6),
    name: "TEST/SOL",
    base: {
      symbol: "TEST",
      mint: "TestMint123",
      address: "TestMint123",
      organic_score: 70,
      organic: 70,
      dev: null,
    } as unknown as PoolData["base"],
    quote: { symbol: "SOL", mint: "So11111111111111111111111111111111111112", address: "So11111111111111111111111111111111111112" },
    pool_type: "dlmm",
    bin_step: 100,
    fee_pct: 0.02,
    active_tvl: 50000,
    fee_window: 25,
    volume_window: 10000,
    fee_active_tvl_ratio: 0.05,
    volatility: 3,
    holders: 1000,
    mcap: 500000,
    organic_score: 70,
    token_age_hours: 48,
    dev: null,
    active_positions: 5,
    active_pct: 50,
    open_positions: 10,
    discord_signal: false,
    discord_signal_count: 0,
    discord_signal_seen_count: 0,
    discord_signal_last_seen_at: null,
    price: 0.001,
    price_change_pct: 5,
    price_trend: "up",
    min_price: 0.0008,
    max_price: 0.0012,
    volume_change_pct: 10,
    fee_change_pct: 2,
    swap_count: 500,
    unique_traders: 200,
    ...overrides,
  };
}

describe("screening", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _blacklistedMints = [];
    _blockedDevWallets = [];
    _blockedDevs = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("scoreCandidate", () => {
    it("scores higher for better fee/tvl ratio", () => {
      const lowFee = makePool({ fee_active_tvl_ratio: 0.02 });
      const highFee = makePool({ fee_active_tvl_ratio: 0.1 });
      expect(scoreCandidate(highFee)).toBeGreaterThan(scoreCandidate(lowFee));
    });

    it("scores higher for better organic score", () => {
      const lowOrganic = makePool({ organic_score: 40 });
      const highOrganic = makePool({ organic_score: 90 });
      expect(scoreCandidate(highOrganic)).toBeGreaterThan(scoreCandidate(lowOrganic));
    });

    it("scores higher for higher volume", () => {
      const lowVolume = makePool({ volume_window: 1000 });
      const highVolume = makePool({ volume_window: 100000 });
      expect(scoreCandidate(highVolume)).toBeGreaterThan(scoreCandidate(lowVolume));
    });

    it("scores higher for more holders", () => {
      const lowHolders = makePool({ holders: 100 });
      const highHolders = makePool({ holders: 10000 });
      expect(scoreCandidate(highHolders)).toBeGreaterThan(scoreCandidate(lowHolders));
    });

    it("returns zero score for empty pool", () => {
      const empty = makePool({
        fee_active_tvl_ratio: 0,
        organic_score: 0,
        volume_window: 0,
        holders: 0,
      });
      expect(scoreCandidate(empty)).toBe(0);
    });
  });

  describe("discoverPools", () => {
    it("throws on API failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" }));
      await expect(discoverPools()).rejects.toThrow("Pool Discovery API error: 500");
    });

    it("returns pools from API response", async () => {
      const mockPool = {
        pool_address: "Pool1",
        name: "TEST/SOL",
        token_x: { symbol: "TEST", address: "TestMint", organic_score: 70, dev: null },
        token_y: { symbol: "SOL", address: "So11111111111111111111111111111111111112" },
        pool_type: "dlmm",
        active_tvl: 50000,
        fee: 25,
        volume: 10000,
        fee_active_tvl_ratio: 0.05,
        volatility: 3,
        base_token_holders: 1000,
        base_token_market_cap: 500000,
        base_token_organic_score: 70,
        token_x_created_at: Date.now() - 48 * 3_600_000,
        active_positions: 5,
        active_positions_pct: 0.5,
        open_positions: 10,
        pool_price: 0.001,
        pool_price_change_pct: 0.5,
        price_trend: "up",
        min_price: 0.0008,
        max_price: 0.0012,
        volume_change_pct: 1,
        fee_change_pct: 0.2,
        swap_count: 500,
        unique_traders: 200,
        dlmm_params: { bin_step: 100 },
        fee_pct: 0.02,
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mockPool], total: 1 }) }));
      const result = await discoverPools();
      expect(result.pools).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.pools![0].pool_address).toBe("Pool1");
    });

    it("filters out blacklisted tokens", async () => {
      _blacklistedMints = ["RugMint"];
      const mockPool = {
        pool_address: "Pool1",
        name: "RUG/SOL",
        token_x: { symbol: "RUG", address: "RugMint", organic_score: 70, dev: null },
        token_y: { symbol: "SOL", address: "So11111111111111111111111111111111111112" },
        pool_type: "dlmm",
        active_tvl: 50000,
        fee: 25,
        volume: 10000,
        fee_active_tvl_ratio: 0.05,
        volatility: 3,
        base_token_holders: 1000,
        base_token_market_cap: 500000,
        base_token_organic_score: 70,
        token_x_created_at: Date.now() - 48 * 3_600_000,
        active_positions: 5,
        active_positions_pct: 0.5,
        open_positions: 10,
        pool_price: 0.001,
        pool_price_change_pct: 0.5,
        price_trend: "up",
        min_price: 0.0008,
        max_price: 0.0012,
        volume_change_pct: 1,
        fee_change_pct: 0.2,
        swap_count: 500,
        unique_traders: 200,
        dlmm_params: { bin_step: 100 },
        fee_pct: 0.02,
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mockPool], total: 1 }) }));
      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });

    it("filters out pools from blocked developers", async () => {
      _blockedDevWallets = ["BadDev"];
      const mockPool = {
        pool_address: "Pool1",
        name: "DEV/SOL",
        token_x: { symbol: "DEV", address: "DevMint", organic_score: 70, dev: "BadDev" },
        token_y: { symbol: "SOL", address: "So11111111111111111111111111111111111112" },
        pool_type: "dlmm",
        active_tvl: 50000,
        fee: 25,
        volume: 10000,
        fee_active_tvl_ratio: 0.05,
        volatility: 3,
        base_token_holders: 1000,
        base_token_market_cap: 500000,
        base_token_organic_score: 70,
        token_x_created_at: Date.now() - 48 * 3_600_000,
        active_positions: 5,
        active_positions_pct: 0.5,
        open_positions: 10,
        pool_price: 0.001,
        pool_price_change_pct: 0.5,
        price_trend: "up",
        min_price: 0.0008,
        max_price: 0.0012,
        volume_change_pct: 1,
        fee_change_pct: 0.2,
        swap_count: 500,
        unique_traders: 200,
        dlmm_params: { bin_step: 100 },
        fee_pct: 0.02,
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mockPool], total: 1 }) }));
      const result = await discoverPools();
      expect(result.pools).toHaveLength(0);
    });
  });

  describe("getTopCandidates", () => {
    it("scores and sorts candidates", async () => {
      const mockPool = {
        pool_address: "Pool1",
        name: "TEST/SOL",
        token_x: { symbol: "TEST", address: "TestMint", organic_score: 80, dev: null },
        token_y: { symbol: "SOL", address: "So11111111111111111111111111111111111112" },
        pool_type: "dlmm",
        active_tvl: 50000,
        fee: 50,
        volume: 20000,
        fee_active_tvl_ratio: 0.1,
        volatility: 3,
        base_token_holders: 2000,
        base_token_market_cap: 500000,
        base_token_organic_score: 80,
        token_x_created_at: Date.now() - 48 * 3_600_000,
        active_positions: 5,
        active_positions_pct: 0.5,
        open_positions: 10,
        pool_price: 0.001,
        pool_price_change_pct: 0.5,
        price_trend: "up",
        min_price: 0.0008,
        max_price: 0.0012,
        volume_change_pct: 1,
        fee_change_pct: 0.2,
        swap_count: 500,
        unique_traders: 200,
        dlmm_params: { bin_step: 100 },
        fee_pct: 0.02,
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mockPool], total: 1 }) }));
      const result = await getTopCandidates({ limit: 5 });
      expect(result.candidates.length).toBeLessThanOrEqual(1);
      if (result.candidates.length > 0) {
        expect(result.candidates[0]).toHaveProperty("score");
      }
    });

    it("returns filtered examples when candidates are filtered by cooldown", async () => {
      vi.spyOn(poolMemory, "isPoolOnCooldown").mockReturnValue(true);
      const mockPool = {
        pool_address: "CoolPool",
        name: "TEST/SOL",
        token_x: { symbol: "TEST", address: "TestMint", organic_score: 80, dev: null },
        token_y: { symbol: "SOL", address: "So11111111111111111111111111111111111112" },
        pool_type: "dlmm",
        active_tvl: 50000,
        fee: 50,
        volume: 20000,
        fee_active_tvl_ratio: 0.1,
        volatility: 3,
        base_token_holders: 2000,
        base_token_market_cap: 500000,
        base_token_organic_score: 80,
        token_x_created_at: Date.now() - 48 * 3_600_000,
        active_positions: 5,
        active_positions_pct: 0.5,
        open_positions: 10,
        pool_price: 0.001,
        pool_price_change_pct: 0.5,
        price_trend: "up",
        min_price: 0.0008,
        max_price: 0.0012,
        volume_change_pct: 1,
        fee_change_pct: 0.2,
        swap_count: 500,
        unique_traders: 200,
        dlmm_params: { bin_step: 100 },
        fee_pct: 0.02,
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mockPool], total: 1 }) }));
      const result = await getTopCandidates();
      expect(result.candidates).toHaveLength(0);
    });

    it("respects limit parameter", async () => {
      const pools = Array(20).fill(null).map((_, i) => ({
        pool_address: `Pool${i}`,
        name: `TEST${i}/SOL`,
        token_x: { symbol: `TEST${i}`, address: `Mint${i}`, organic_score: 70 + i, dev: null },
        token_y: { symbol: "SOL", address: "So11111111111111111111111111111111111112" },
        pool_type: "dlmm",
        active_tvl: 50000,
        fee: 25 + i,
        volume: 10000 + i * 1000,
        fee_active_tvl_ratio: 0.05 + i * 0.01,
        volatility: 3,
        base_token_holders: 1000 + i * 100,
        base_token_market_cap: 500000,
        base_token_organic_score: 70 + i,
        token_x_created_at: Date.now() - 48 * 3_600_000,
        active_positions: 5,
        active_positions_pct: 0.5,
        open_positions: 10,
        pool_price: 0.001,
        pool_price_change_pct: 0.5,
        price_trend: "up",
        min_price: 0.0008,
        max_price: 0.0012,
        volume_change_pct: 1,
        fee_change_pct: 0.2,
        swap_count: 500,
        unique_traders: 200,
        dlmm_params: { bin_step: 100 },
        fee_pct: 0.02,
      }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: pools, total: 20 }) }));
      const result = await getTopCandidates({ limit: 3 });
      expect(result.candidates.length).toBeLessThanOrEqual(3);
    });
  });
});
