import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-test-"));

beforeEach(() => {
  process.env.WALLET_PRIVATE_KEY = "5Jd7fFJ6eB2Z8d9qQZ7LZsG8Nz6vK7wL9mN3pR5tY1uU2wX3yZ4aA5bB6cC7dD8eE9fF0gG1hH2iI3jJ4kK5lL6mM7nN8oO9pP0qQ1rR2sS3tT4uU5vV6wW7xX8yY9zZ";
  process.env.DRY_RUN = "true";
});

afterEach(() => {
  delete process.env.WALLET_PRIVATE_KEY;
  delete process.env.DRY_RUN;
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// Mock @meteora-ag/dlmm with all required functions
vi.mock("@meteora-ag/dlmm", () => {
  const mockPool = {
    lbPair: {
      parameters: { baseFactor: 1000, binStep: 100 },
      activeBin: { binId: 100 },
      tokenXMint: "tokenXMint",
      tokenYMint: "tokenYMint",
    },
    getBinArrayLowerUpper: vi.fn().mockResolvedValue([{ lowerBinId: 0, upperBinId: 200 }]),
    getBinArrayForBinId: vi.fn().mockResolvedValue({ lowerBinId: 0, upperBinId: 200 }),
    getPosition: vi.fn().mockResolvedValue({
      positionData: {
        lbPair: "pool-address",
        feeX: { toNumber: () => 1000000 },
        feeY: { toNumber: () => 1000000 },
        totalXAmount: { toNumber: () => 500000000 },
        totalYAmount: { toNumber: () => 500000000 },
      },
    }),
    getPositionsByUser: vi.fn().mockResolvedValue({ positions: [] }),
    getActiveBin: vi.fn().mockResolvedValue({ binId: 100 }),
    swapQuote: vi.fn().mockResolvedValue({ minOutAmount: 1000000, inAmount: 1000000 }),
    swap: vi.fn().mockResolvedValue({}),
    removeLiquidity: vi.fn().mockResolvedValue({}),
    addLiquidity: vi.fn().mockResolvedValue({}),
    getBin: vi.fn().mockResolvedValue({}),
    refetchStates: vi.fn().mockResolvedValue({}),
    fromPricePerLamport: vi.fn().mockReturnValue(1.5),
  };

  return {
    default: {
      create: vi.fn().mockResolvedValue(mockPool),
      getBinIdFromPrice: vi.fn().mockReturnValue(100),
    },
    StrategyType: { Spot: "Spot", BidAsk: "BidAsk", Curve: "Curve" },
    getPriceOfBinByBinId: vi.fn().mockReturnValue(1.5),
    getBinArrayKeysCoverage: vi.fn().mockResolvedValue([[0, 200]]),
    getBinArrayIndexesCoverage: vi.fn().mockResolvedValue([[0, 200]]),
    deriveBinArrayBitmapExtension: vi.fn().mockResolvedValue("mock-extension"),
    isOverflowDefaultBinArrayBitmap: vi.fn().mockReturnValue(false),
    BIN_ARRAY_FEE: 100,
    BIN_ARRAY_BITMAP_FEE: 200,
  };
});

vi.mock("@solana/web3.js", () => ({
  Connection: vi.fn().mockImplementation(() => ({
    getBalance: vi.fn().mockResolvedValue(1000000000),
    sendTransaction: vi.fn().mockResolvedValue("mock-signature"),
    confirmTransaction: vi.fn().mockResolvedValue({}),
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: "mock", lastValidBlockHeight: 100 }),
  })),
  Keypair: {
    fromSecretKey: vi.fn().mockReturnValue({
      publicKey: { toBase58: () => "mock-pubkey", toString: () => "mock-pubkey" },
      secretKey: new Uint8Array(64).fill(1),
    }),
  },
  PublicKey: vi.fn().mockImplementation((key) => ({ toBase58: () => key, toString: () => key })),
  SystemProgram: { programId: "programId" },
  Transaction: vi.fn().mockImplementation(() => ({ add: vi.fn(), serialize: vi.fn().mockReturnValue(new Uint8Array(64)) })),
  VersionedTransaction: vi.fn().mockImplementation(() => ({})),
  sendAndConfirmTransaction: vi.fn().mockResolvedValue("mock-tx-signature"),
  LAMPORTS_PER_SOL: 1000000000,
  ComputeBudgetProgram: { setComputeUnitPrice: vi.fn(), setComputeUnitLimit: vi.fn() },
}));

vi.mock("../src/core/config/config.js", () => ({
  config: {
    screening: { minBinStep: 80, maxBinStep: 125, minFeeActiveTvlRatio: 0.05 },
    management: { deployAmountSol: 0.5, gasReserve: 0.2, maxPositions: 3 },
    risk: { maxDeployAmount: 50, maxPositions: 3 },
    schedule: { managementIntervalMin: 10, screeningIntervalMin: 30 },
    llm: { maxSteps: 20, temperature: 0.2, maxTokens: 4096 },
    strategy: { strategy: "wide", binsBelow: 35, binsAbove: 15 },
  },
  computeDeployAmount: vi.fn().mockReturnValue(0.5),
}));

vi.mock("../src/core/state/state.js", () => ({
  trackPosition: vi.fn(),
  markOutOfRange: vi.fn(),
  markInRange: vi.fn(),
  recordClaim: vi.fn(),
  recordClose: vi.fn(),
  getTrackedPosition: vi.fn().mockReturnValue(null),
  minutesOutOfRange: vi.fn().mockReturnValue(0),
  syncOpenPositions: vi.fn(),
  getStateSummary: vi.fn().mockReturnValue({}),
}));

vi.mock("../src/core/state/lessons.js", () => ({
  recordPerformance: vi.fn(),
}));

vi.mock("../src/core/state/pool-memory.js", () => ({
  isBaseMintOnCooldown: vi.fn().mockReturnValue(false),
  isPoolOnCooldown: vi.fn().mockReturnValue(false),
  recordPoolDeploy: vi.fn(),
}));

vi.mock("../src/tools/wallet.js", () => ({
  normalizeMint: vi.fn().mockResolvedValue("normalized-mint"),
  getWalletBalances: vi.fn().mockResolvedValue({ sol: 10, tokens: [] }),
}));

vi.mock("../src/core/logger/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("../src/core/state/decision-log.js", () => ({
  appendDecision: vi.fn(),
}));

vi.mock("../src/tools/agent-meridian.js", () => ({
  agentMeridianJson: vi.fn().mockResolvedValue({}),
  getAgentIdForRequests: vi.fn().mockReturnValue("test-agent"),
  getAgentMeridianHeaders: vi.fn().mockReturnValue({}),
}));

describe("dlmm.ts", () => {
  describe("module exports", () => {
    it("should export all required functions", async () => {
      const dlmm = await import("../src/tools/dlmm.js");
      expect(typeof dlmm.deployPosition).toBe("function");
      expect(typeof dlmm.getMyPositions).toBe("function");
      expect(typeof dlmm.getPositionPnl).toBe("function");
      expect(typeof dlmm.closePosition).toBe("function");
      expect(typeof dlmm.claimFees).toBe("function");
      expect(typeof dlmm.getActiveBin).toBe("function");
      expect(typeof dlmm.searchPools).toBe("function");
      expect(typeof dlmm.getWalletPositions).toBe("function");
      expect(typeof dlmm.addLiquidity).toBe("function");
      expect(typeof dlmm.withdrawLiquidity).toBe("function");
    });
  });

  describe("input validation", () => {
    it("getActiveBin should handle empty pool_address", async () => {
      const { getActiveBin } = await import("../src/tools/dlmm.js");
      const result = await getActiveBin({ pool_address: "" });
      expect(result.success).toBe(false);
    });

    it("closePosition should handle empty position_address", async () => {
      const { closePosition } = await import("../src/tools/dlmm.js");
      const result = await closePosition({ position_address: "" });
      expect(result.success).toBe(false);
    });

    it("claimFees should handle empty position_address", async () => {
      const { claimFees } = await import("../src/tools/dlmm.js");
      const result = await claimFees({ position_address: "" });
      expect(result.success).toBe(false);
    });

    it("withdrawLiquidity should validate bps > 10000", async () => {
      const { withdrawLiquidity } = await import("../src/tools/dlmm.js");
      const result = await withdrawLiquidity({ position_address: "test", pool_address: "pool", bps: 15000 });
      expect(result.success).toBe(false);
    });

    it("withdrawLiquidity should validate bps <= 0", async () => {
      const { withdrawLiquidity } = await import("../src/tools/dlmm.js");
      const result = await withdrawLiquidity({ position_address: "test", pool_address: "pool", bps: 0 });
      expect(result.success).toBe(false);
    });
  });

  describe("with DRY_RUN", () => {
    it("deployPosition should work with DRY_RUN=true", async () => {
      const { deployPosition } = await import("../src/tools/dlmm.js");
      const result = await deployPosition({
        pool_address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        amount_sol: 0.5,
      });
      // In DRY_RUN, should not fail on network calls
      expect(result).toBeDefined();
    });
  });
});
