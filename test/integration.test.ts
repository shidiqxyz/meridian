import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { normalizeMint, swapToken, getWalletBalances } from "../src/tools/wallet.js";
import { getTokenNarrative, getTokenInfo, getTokenHolders } from "../src/tools/token.js";
import { studyTopLPers } from "../src/tools/study.js";
import * as agentMeridian from "../src/tools/agent-meridian.js";
import * as okx from "../src/tools/okx.js";
import * as smartWallets from "../src/services/smart-wallets.js";

describe("Integration Tests", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.DRY_RUN = "true";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DRY_RUN;
  });

  describe("wallet.ts", () => {
    describe("normalizeMint", () => {
      it("normalizes various SOL representations to wrapped SOL mint", () => {
        expect(normalizeMint("SOL")).toBe("So11111111111111111111111111111112");
        expect(normalizeMint("native")).toBe("So11111111111111111111111111111112");
        expect(normalizeMint("So11111111111111111111111111111112")).toBe("So11111111111111111111111111111112");
        expect(normalizeMint("So1")).toBe("So11111111111111111111111111111112");
        expect(normalizeMint("So1234567890123456789012345678901234")).toBe("So11111111111111111111111111111112");
      });

      it("leaves non-SOL mints unchanged", () => {
        expect(normalizeMint("EPjFWdd5AufqSSqeMqeiNukk1B242nS")).toBe("EPjFWdd5AufqSSqeMqeiNukk1B242nS");
        expect(normalizeMint("")).toBe("");
      });
    });

    describe("swapToken", () => {
      it("returns dry run result when DRY_RUN is true", async () => {
        process.env.DRY_RUN = "true";
        const result = await swapToken({
          input_mint: "So11111111111111111111111111111112",
          output_mint: "EPjFWdd5AufqSSqeMqeiNukk1B242nS",
          amount: 0.1,
        });
        expect(result.dry_run).toBe(true);
        expect(result.would_swap).toEqual({
          input_mint: "So11111111111111111111111111111112",
          output_mint: "EPjFWdd5AufqSSqeMqeiNukk1B242nS",
          amount: 0.1,
        });
      });
    });

    describe("getWalletBalances", () => {
      it("returns error when wallet not configured", async () => {
        const originalKey = process.env.WALLET_PRIVATE_KEY;
        delete process.env.WALLET_PRIVATE_KEY;
        const result = await getWalletBalances();
        expect(result.error).toBe("Wallet not configured");
        process.env.WALLET_PRIVATE_KEY = originalKey;
      });
    });
  });

  describe("token.ts", () => {
    describe("getTokenNarrative", () => {
      it("returns narrative from Jupiter API", async () => {
        const mockResponse = { narrative: "AI meme token", status: "active" };
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => mockResponse }));
        const result = await getTokenNarrative({ mint: "TestMint" });
        expect(result.mint).toBe("TestMint");
        expect(result.narrative).toBe("AI meme token");
        expect(result.status).toBe("active");
      });

      it("throws on API error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
        await expect(getTokenNarrative({ mint: "TestMint" })).rejects.toThrow("Narrative API error: 404");
      });
    });

    describe("getTokenInfo", () => {
      it("returns token search results", async () => {
        const mockToken = {
          id: "TestMint",
          name: "Test Token",
          symbol: "TEST",
          mcap: 500000,
          usdPrice: 0.05,
          liquidity: 100000,
          holderCount: 1000,
          organicScore: 75,
          organicScoreLabel: "organic",
          launchpad: "pump.fun",
          graduatedPool: true,
          fees: 50,
          audit: {
            mintAuthorityDisabled: true,
            freezeAuthorityDisabled: true,
            topHoldersPercentage: 30,
            botHoldersPercentage: 5,
            devMigrations: 2,
          },
          stats1h: {
            priceChange: 2.5,
            buyVolume: 10000,
            sellVolume: 8000,
            numOrganicBuyers: 50,
            numNetBuyers: 10,
          },
          stats24h: { numNetBuyers: 100 },
        };
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [mockToken] }));
        vi.spyOn(okx, "getAdvancedInfo").mockResolvedValue({ status: "fulfilled", value: null });
        vi.spyOn(okx, "getClusterList").mockResolvedValue({ status: "fulfilled", value: [] });
        const result = await getTokenInfo({ query: "TestMint" });
        expect(result.found).toBe(true);
        expect(result.results).toHaveLength(1);
        expect(result.results[0].mint).toBe("TestMint");
        expect(result.results[0].name).toBe("Test Token");
        expect(result.results[0].audit).not.toBeNull();
        expect(result.results[0].stats_1h).not.toBeNull();
      });

      it("returns empty results when not found", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
        const result = await getTokenInfo({ query: "NonExistent" });
        expect(result.found).toBe(false);
        expect(result.results).toHaveLength(0);
      });
    });

    describe("getTokenHolders", () => {
      it("returns holder data with pool filtering", async () => {
        const mockHolders = [
          { address: "PoolAddr", amount: 1000000, tags: [{ name: "Raydium Pool" }] },
          { address: "Holder1", amount: 500000, tags: [] },
          { address: "Holder2", amount: 300000, tags: [{ name: "CEX" }] },
        ];
        const mockTokenInfo = { id: "TestMint", totalSupply: 10000000, fees: 50 };
        vi.stubGlobal("fetch", vi.fn()
          .mockResolvedValueOnce({ ok: true, json: async () => mockHolders })
          .mockResolvedValueOnce({ ok: true, json: async () => mockTokenInfo })
        );
        vi.spyOn(okx, "getAdvancedInfo").mockResolvedValue({ status: "fulfilled", value: { bundle_pct: 15 } });
        vi.spyOn(smartWallets, "listSmartWallets").mockReturnValue({ total: 0, wallets: [] });
        const result = await getTokenHolders({ mint: "TestMint", limit: 10 });
        expect(result.mint).toBe("TestMint");
        expect(result.showing).toBe(3);
        expect(result.holders?.[0]?.is_pool).toBe(true);
        expect(result.holders?.[1]?.is_pool).toBeUndefined();
      });
    });
  });

  describe("study.ts", () => {
    describe("studyTopLPers", () => {
      it("returns LPer patterns from Agent Meridian API", async () => {
        const mockPoolRes = {
          topLpers: [
            {
              owner: "Owner1",
              ownerShort: "Own...1",
              avgAgeHours: 24,
              totalLp: 10,
              pnlPerInflowPct: 15.5,
              feePercent: 2.5,
              totalPnlUsd: 500,
              totalInflowUsd: 1000,
              winRatePct: 60,
              roiPct: 50,
              feePctOfCapital: 5,
            },
          ],
          historicalOwners: [
            {
              owner: "Owner1",
              preferredStrategy: "concentrated",
              preferredRangeStyle: "wide",
              avgHoldHours: 24,
              avgPnlPct: 15,
              avgFeePercent: 2.5,
              roiPct: 50,
              topPositions: [
                { ageHours: 24, pnlUsd: 500, pnlPct: 15, feeUsd: 25, inRange: true, strategy: "concentrated", rangeStyle: "wide", inputValue: 1000, feePercent: 2.5, widthBins: 10, lowerBinId: 100, upperBinId: 200 },
              ],
            },
          ],
          overview: { name: "TEST/SOL", tokenXSymbol: "TEST", tokenYSymbol: "SOL" },
        };
        const mockSignalRes = {
          activePositionCount: 5,
          ownerCount: 10,
          suggestedStyle: "wide",
          topHistoricalOwners: [],
        };
        vi.spyOn(agentMeridian, "agentMeridianJson")
          .mockResolvedValueOnce(mockPoolRes)
          .mockResolvedValueOnce(mockSignalRes);
        const result = await studyTopLPers({ pool_address: "Pool1", limit: 3 });
        expect(result.pool).toBe("Pool1");
        expect(result.pool_name).toBe("TEST/SOL");
        expect(result.patterns).toBeDefined();
        expect(result.patterns!.top_lper_count).toBe(1);
        expect(result.patterns!.suggested_style).toBe("wide");
        expect(result.lpers).toHaveLength(1);
        expect(result.lpers![0].owner).toBe("Owner1");
        expect(result.lpers![0].positions).toHaveLength(1);
      });

      it("returns empty when no LPer data found", async () => {
        vi.spyOn(agentMeridian, "agentMeridianJson")
          .mockResolvedValueOnce({ topLpers: [], historicalOwners: [], overview: {} })
          .mockResolvedValueOnce({});
        const result = await studyTopLPers({ pool_address: "EmptyPool" });
        expect(result.pool).toBe("EmptyPool");
        expect(result.message).toContain("No LPAgent top LPer data");
        expect(result.lpers).toHaveLength(0);
      });
    });
  });
});
