import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stageSignals, consumeSignals } from "../src/core/state/signal-tracker.js";
import { recalculateWeights, getWeightsSummary } from "../src/core/state/signal-weights.js";
import {
  recordPoolDeploy,
  isPoolOnCooldown,
  isBaseMintOnCooldown,
  getPoolMemory,
  recordPositionSnapshot,
  recallForPool,
  addPoolNote,
} from "../src/core/state/pool-memory.js";
import * as fs from "fs";
import { config } from "../src/core/config/config.js";

describe("signal-tracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stages and consumes signals", () => {
    stageSignals("Pool1", { organic_score: 75, volume: 10000 });
    const signals = consumeSignals("Pool1");
    expect(signals).not.toBeNull();
    expect(signals!.organic_score).toBe(75);
    expect(signals!.volume).toBe(10000);
  });

  it("returns null for unknown pool", () => {
    expect(consumeSignals("Unknown")).toBeNull();
  });

  it("clears signals after consumption", () => {
    stageSignals("Pool2", { organic_score: 80 });
    consumeSignals("Pool2");
    expect(consumeSignals("Pool2")).toBeNull();
  });

  it("cleans up expired entries on next stage call", () => {
    stageSignals("Pool3", { organic_score: 60 });
    vi.advanceTimersByTime(11 * 60 * 1000);
    // Cleanup is lazy — triggered by next stageSignals call
    stageSignals("OtherPool", { organic_score: 50 });
    expect(consumeSignals("Pool3")).toBeNull();
  });
});

describe("signal-weights", () => {
  const WEIGHTS_FILE = "./src/signal-weights.json";

  beforeEach(() => {
    if (fs.existsSync(WEIGHTS_FILE)) fs.unlinkSync(WEIGHTS_FILE);
  });

  afterEach(() => {
    if (fs.existsSync(WEIGHTS_FILE)) fs.unlinkSync(WEIGHTS_FILE);
  });

  it("starts with default weights", () => {
    const summary = getWeightsSummary();
    expect(summary).toContain("organic_score");
    expect(summary).toContain("using defaults");
  });

  it("skips recalculation when not enough samples", () => {
    const result = recalculateWeights([{ pnl_usd: 100, recorded_at: new Date().toISOString() }]);
    expect(result.changes).toHaveLength(0);
  });

  it("skips recalculation when all positions are winners or losers", () => {
    const perfData = Array(15).fill(null).map((_, i) => ({
      pnl_usd: i < 15 ? 100 : -100,
      recorded_at: new Date().toISOString(),
      signal_snapshot: { organic_score: 70 + i },
    }));
    const result = recalculateWeights(perfData);
    expect(result.changes).toHaveLength(0);
  });

  it("recalculates weights with mixed win/loss data", () => {
    const perfData = Array(20).fill(null).map((_, i) => ({
      pnl_usd: i < 10 ? 200 : -100,
      recorded_at: new Date().toISOString(),
      signal_snapshot: { organic_score: i < 10 ? 90 : 30 },
    }));
    const result = recalculateWeights(perfData, { darwin: { minSamples: 10, windowDays: 60 } });
    expect(Object.keys(result.weights)).toContain("organic_score");
    expect(result.weights.organic_score).not.toBe(1.0);
  });

  it("boosts top quartile signals and decays bottom quartile", () => {
    const perfData = Array(20).fill(null).map((_, i) => ({
      pnl_usd: i < 10 ? 200 : -100,
      recorded_at: new Date().toISOString(),
      signal_snapshot: {
        organic_score: i < 10 ? 90 : 30,
        volume: i < 10 ? 50000 : 1000,
      },
    }));
    const result = recalculateWeights(perfData, { darwin: { minSamples: 10, windowDays: 60, boostFactor: 1.1, decayFactor: 0.9 } });
    const changes = result.changes;
    expect(changes.length).toBeGreaterThan(0);
    const boosted = changes.filter((c) => c.action === "boosted");
    const decayed = changes.filter((c) => c.action === "decayed");
    expect(boosted.length + decayed.length).toBeGreaterThan(0);
  });

  it("respects weight floor and ceiling", () => {
    const perfData = Array(20).fill(null).map((_, i) => ({
      pnl_usd: i < 10 ? 200 : -100,
      recorded_at: new Date().toISOString(),
      signal_snapshot: { organic_score: i < 10 ? 90 : 30 },
    }));
    const result = recalculateWeights(perfData, {
      darwin: { minSamples: 10, windowDays: 60, boostFactor: 5.0, decayFactor: 0.1, weightFloor: 0.5, weightCeiling: 2.0 },
    });
    for (const val of Object.values(result.weights)) {
      expect(val).toBeGreaterThanOrEqual(0.5);
      expect(val).toBeLessThanOrEqual(2.0);
    }
  });

  it("handles boolean signal lift", () => {
    const perfData = Array(20).fill(null).map((_, i) => ({
      pnl_usd: i < 10 ? 200 : -100,
      recorded_at: new Date().toISOString(),
      signal_snapshot: { smart_wallets_present: i < 10 },
    }));
    const result = recalculateWeights(perfData, { darwin: { minSamples: 10 } });
    expect(result.weights).toBeDefined();
  });

  it("handles categorical signal lift", () => {
    const perfData = Array(20).fill(null).map((_, i) => ({
      pnl_usd: i < 10 ? 200 : -100,
      recorded_at: new Date().toISOString(),
      signal_snapshot: { narrative_quality: i < 10 ? "strong" : "weak" },
    }));
    const result = recalculateWeights(perfData, { darwin: { minSamples: 10 } });
    expect(result.weights).toBeDefined();
  });

  it("filters by rolling window", () => {
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const nowDate = new Date().toISOString();
    const perfData = [
      ...Array(10).fill(null).map(() => ({ pnl_usd: 200, recorded_at: oldDate, signal_snapshot: { organic_score: 90 } })),
      ...Array(5).fill(null).map(() => ({ pnl_usd: -100, recorded_at: nowDate, signal_snapshot: { organic_score: 30 } })),
    ];
    const result = recalculateWeights(perfData, { darwin: { minSamples: 10, windowDays: 60 } });
    expect(result.changes).toHaveLength(0);
  });

  it("tracks history across multiple recalculations", () => {
    const perfData = Array(20).fill(null).map((_, i) => ({
      pnl_usd: i < 10 ? 200 : -100,
      recorded_at: new Date().toISOString(),
      signal_snapshot: { organic_score: i < 10 ? 90 : 30, volume: i < 10 ? 50000 : 1000 },
    }));
    recalculateWeights(perfData, { darwin: { minSamples: 10, boostFactor: 1.05 } });
    recalculateWeights(perfData, { darwin: { minSamples: 10, boostFactor: 1.05 } });
    const summary = getWeightsSummary();
    expect(summary).toContain("Last recalculated:");
  });
});

describe("pool-memory", () => {
  const POOL_FILE = "./pool-memory.json";

  beforeEach(() => {
    if (fs.existsSync(POOL_FILE)) fs.unlinkSync(POOL_FILE);
  });

  afterEach(() => {
    if (fs.existsSync(POOL_FILE)) fs.unlinkSync(POOL_FILE);
  });

  describe("recordPoolDeploy", () => {
    it("creates new pool entry on first deploy", () => {
      recordPoolDeploy("Pool1", {
        pool_name: "TEST/SOL",
        base_mint: "TestMint",
        pnl_pct: 5.5,
        pnl_usd: 100,
      });
      const memory = getPoolMemory({ pool_address: "Pool1" });
      expect(memory.known).toBe(true);
      expect(memory.name).toBe("TEST/SOL");
      expect(memory.total_deploys).toBe(1);
      expect(memory.avg_pnl_pct).toBe(5.5);
      expect(memory.win_rate).toBe(1);
    });

    it("aggregates win rate across multiple deploys", () => {
      recordPoolDeploy("Pool2", { pool_name: "TEST/SOL", pnl_pct: 10 });
      recordPoolDeploy("Pool2", { pool_name: "TEST/SOL", pnl_pct: -5 });
      recordPoolDeploy("Pool2", { pool_name: "TEST/SOL", pnl_pct: 20 });
      const memory = getPoolMemory({ pool_address: "Pool2" });
      expect(memory.total_deploys).toBe(3);
      expect(memory.win_rate).toBeCloseTo(2 / 3, 2);
    });

    it("sets cooldown on low yield close", () => {
      recordPoolDeploy("Pool3", { pool_name: "TEST/SOL", pnl_pct: 0.5, close_reason: "low yield" });
      const memory = getPoolMemory({ pool_address: "Pool3" });
      expect(memory.cooldown_until).toBeDefined();
      expect(memory.cooldown_reason).toBe("low yield");
    });

    it("tracks last outcome correctly", () => {
      recordPoolDeploy("Pool4", { pool_name: "TEST/SOL", pnl_pct: -10 });
      const memory = getPoolMemory({ pool_address: "Pool4" });
      expect(memory.last_outcome).toBe("loss");
    });
  });

  describe("cooldown checks", () => {
    it("detects active pool cooldown", () => {
      recordPoolDeploy("Pool5", { pool_name: "TEST/SOL", pnl_pct: 0.5, close_reason: "low yield" });
      expect(isPoolOnCooldown("Pool5")).toBe(true);
    });

    it("returns false for unknown pool cooldown", () => {
      expect(isPoolOnCooldown("Unknown")).toBe(false);
    });

    it("returns false for expired cooldown", () => {
      recordPoolDeploy("Pool6", { pool_name: "TEST/SOL", pnl_pct: 0.5, close_reason: "low yield" });
      const memory = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
      memory["Pool6"].cooldown_until = new Date(Date.now() - 1000).toISOString();
      fs.writeFileSync(POOL_FILE, JSON.stringify(memory));
      expect(isPoolOnCooldown("Pool6")).toBe(false);
    });

    it("detects base mint cooldown", () => {
      recordPoolDeploy("Pool7", { pool_name: "TEST/SOL", base_mint: "Mint7", pnl_pct: 10 });
      const memory = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
      memory["Pool7"].base_mint_cooldown_until = new Date(Date.now() + 3600000).toISOString();
      fs.writeFileSync(POOL_FILE, JSON.stringify(memory));
      expect(isBaseMintOnCooldown("Mint7")).toBe(true);
    });
  });

  describe("getPoolMemory", () => {
    it("returns unknown for new pool", () => {
      const result = getPoolMemory({ pool_address: "NewPool" });
      expect(result.known).toBe(false);
      expect(result.message).toContain("first time");
    });

    it("returns empty for missing pool_address", () => {
      const result = getPoolMemory({ pool_address: "" });
      expect(result.known).toBe(false);
      expect(result.message).toBe("pool_address required");
    });

    it("returns last 10 deploys in history", () => {
      for (let i = 0; i < 15; i++) {
        recordPoolDeploy("Pool8", { pool_name: "TEST/SOL", pnl_pct: i * 2 });
      }
      const memory = getPoolMemory({ pool_address: "Pool8" });
      expect(memory.history).toHaveLength(10);
    });
  });

  describe("recordPositionSnapshot", () => {
    it("stores snapshots with timestamp", () => {
      recordPositionSnapshot("Pool9", { pair: "TEST/SOL", pnl_pct: 5, in_range: true });
      const memory = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
      expect(memory["Pool9"].snapshots).toHaveLength(1);
      expect(memory["Pool9"].snapshots[0].pnl_pct).toBe(5);
    });

    it("caps snapshots at 48", () => {
      for (let i = 0; i < 60; i++) {
        recordPositionSnapshot("Pool10", { pnl_pct: i });
      }
      const memory = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
      expect(memory["Pool10"].snapshots).toHaveLength(48);
    });
  });

  describe("recallForPool", () => {
    it("returns null for unknown pool", () => {
      expect(recallForPool("Unknown")).toBeNull();
    });

    it("returns null for empty pool_address", () => {
      expect(recallForPool("")).toBeNull();
    });

    it("includes deploy history summary", () => {
      recordPoolDeploy("Pool11", { pool_name: "TEST/SOL", pnl_pct: 15 });
      const recall = recallForPool("Pool11");
      expect(recall).toContain("1 past deploy");
      expect(recall).toContain("TEST/SOL");
    });

    it("includes recent trend from snapshots", () => {
      recordPoolDeploy("Pool12", { pool_name: "TEST/SOL", pnl_pct: 10 });
      recordPositionSnapshot("Pool12", { pnl_pct: 5, in_range: true });
      recordPositionSnapshot("Pool12", { pnl_pct: 10, in_range: true });
      const recall = recallForPool("Pool12");
      expect(recall).toContain("RECENT TREND:");
      expect(recall).toContain("PnL drift");
    });
  });

  describe("addPoolNote", () => {
    it("saves note to pool", () => {
      const result = addPoolNote({ pool_address: "Pool13", note: "Good entry point" });
      expect(result.saved).toBe(true);
      expect(result.note).toBe("Good entry point");
    });

    it("creates pool entry if not exists", () => {
      addPoolNote({ pool_address: "Pool14", note: "First note" });
      const memory = getPoolMemory({ pool_address: "Pool14" });
      expect(memory.known).toBe(true);
    });

    it("rejects empty pool_address", () => {
      const result = addPoolNote({ pool_address: "", note: "test" });
      expect(result.saved).toBe(false);
    });

    it("rejects empty note", () => {
      const result = addPoolNote({ pool_address: "Pool15", note: "" });
      expect(result.saved).toBe(false);
    });

    it("truncates notes over 280 chars", () => {
      const longNote = "x".repeat(300);
      const result = addPoolNote({ pool_address: "Pool16", note: longNote });
      expect(result.saved).toBe(true);
      expect(result.note!.length).toBeLessThanOrEqual(280);
    });

    it("includes note in recall", () => {
      addPoolNote({ pool_address: "Pool17", note: "Watch this" });
      const recall = recallForPool("Pool17");
      expect(recall).toContain("NOTE:");
      expect(recall).toContain("Watch this");
    });
  });
});
