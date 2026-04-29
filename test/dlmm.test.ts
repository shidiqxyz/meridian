import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deployPosition, getMyPositions } from "../src/tools/dlmm.js";
import { config } from "../src/core/config/config.js";
import * as state from "../src/core/state/state.js";
import * as poolMemory from "../src/core/state/pool-memory.js";

// Mock dependencies
vi.mock("../src/tools/wallet.js", () => ({
  normalizeMint: (v: string) => v,
  getWalletBalances: async () => ({ sol: 10, tokens: [] }),
}));

vi.mock("@meteora-ag/dlmm", () => {
  const mockPool = {
    lbPair: {
      tokenXMint: "BaseMint123",
      tokenYMint: "So11111111111111111111111111111111111112",
      binStep: 100,
      parameters: { baseFactor: 0 },
    },
    getActiveBin: async () => ({ binId: 1000, price: new (class { toString() { return "1000000000000000"; } })() }),
    fromPricePerLamport: (n: number) => n / 1e14,
  };
  return {
    default: class {
      static create = async () => mockPool;
      static getBinIdFromPrice = (price: number, step: number) => Math.round(price / step);
      static getStrategyType = { spot: "spot", curve: "curve", bid_ask: "bid_ask" };
    },
    StrategyType: { spot: "spot", curve: "curve", bid_ask: "bid_ask" },
    getPriceOfBinByBinId: (binId: number) => ({ toString: () => String(binId * 1000) }),
    getBinIdFromPrice: (price: number) => Math.round(price),
    BIN_ARRAY_FEE: 0.07143744,
    BIN_ARRAY_BITMAP_FEE: 0.01180416,
    getBinArrayKeysCoverage: () => [],
    getBinArrayIndexesCoverage: () => [],
    isOverflowDefaultBinArrayBitmap: () => false,
    deriveBinArrayBitmapExtension: () => [],
  };
});

vi.mock("@solana/web3.js", () => ({
  Connection: class {},
  Keypair: {
    generate: () => ({ publicKey: { toString: () => "NewPos123" } }),
    fromSecretKey: () => ({ publicKey: { toString: () => "Wallet123" } }),
  },
  PublicKey: class { toString() { return "pk"; } },
  SystemProgram: { programId: "system" },
  SystemInstruction: { decodeInstructionType: () => null },
  Transaction: class {},
  VersionedTransaction: class {},
  sendAndConfirmTransaction: async () => "txhash",
}));

describe("dlmm deploy safety", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Ensure DRY_RUN is off for most tests unless specified
    delete process.env.DRY_RUN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("dry run", () => {
    it("returns would_deploy without executing", async () => {
      process.env.DRY_RUN = "true";
      const result = await deployPosition({
        pool_address: "Pool1",
        amount_sol: 0.5,
        downside_pct: 5,
        upside_pct: 5,
      });
      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
      expect(result.would_deploy).toBeDefined();
      expect(result.message).toContain("DRY RUN");
    });
  });

  describe("strategy validation", () => {
    it("defaults to config strategy when not provided", async () => {
      process.env.DRY_RUN = "true";
      // config.strategy.strategy should default to something
      const result = await deployPosition({ pool_address: "Pool1" });
      expect(result.success).toBe(true);
      if (result.would_deploy) {
        expect(typeof result.would_deploy.strategy).toBe("string");
      }
    });
  });

  describe("cooldown checks", () => {
    it("rejects deploy when pool is on cooldown", async () => {
      vi.spyOn(poolMemory, "isPoolOnCooldown").mockReturnValue(true);
      const result = await deployPosition({ pool_address: "CoolPool" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("cooldown");
    });

    it("rejects deploy when base mint is on cooldown", async () => {
      vi.spyOn(poolMemory, "isPoolOnCooldown").mockReturnValue(false);
      vi.spyOn(poolMemory, "isBaseMintOnCooldown").mockReturnValue(true);
      const result = await deployPosition({ pool_address: "BaseMint123" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("cooldown");
    });
  });
});

describe("dlmm getMyPositions", () => {
  it("returns wallet not configured when private key is missing", async () => {
    const origKey = process.env.WALLET_PRIVATE_KEY;
    delete process.env.WALLET_PRIVATE_KEY;
    // Force cache bust
    const result = await getMyPositions({ force: true, silent: true });
    expect(result.error).toContain("Wallet not configured");
    expect(result.total_positions).toBe(0);
    process.env.WALLET_PRIVATE_KEY = origKey;
  });
});
