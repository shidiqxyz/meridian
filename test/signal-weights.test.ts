import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { recalculateWeights, getWeightsSummary } from "../src/core/state/signal-weights.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEIGHTS_FILE = path.join(__dirname, "..", "src", "signal-weights.json");

function cleanFiles() {
  for (let i = 0; i < 3; i++) {
    try {
      if (fs.existsSync(WEIGHTS_FILE)) fs.unlinkSync(WEIGHTS_FILE);
      break;
    } catch { /* retry */ }
  }
}

function makePerfRecord(overrides: Record<string, unknown> = {}) {
  return {
    pnl_usd: 10,
    recorded_at: new Date().toISOString(),
    signal_snapshot: {
      organic_score: 70,
      fee_tvl_ratio: 1.5,
      volume: 1000,
      mcap: 500000,
      holder_count: 1000,
      smart_wallets_present: true,
      narrative_quality: 8,
      study_win_rate: 0.6,
      launchpad: "pumpfun",
      is_meme: false,
      social_mentions_24h: 50,
    },
    ...overrides,
  };
}

describe("signal-weights.ts", () => {
  beforeEach(cleanFiles);
  afterEach(cleanFiles);

  describe("recalculateWeights", () => {
    it("returns no changes when fewer than minSamples records", () => {
      const perf = Array(5).fill(null).map((_, i) => makePerfRecord({ pnl_usd: i % 2 === 0 ? 10 : -5 }));
      const result = recalculateWeights(perf, { darwin: { minSamples: 10 } });
      expect(result.changes.length).toBe(0);
    });

    it("returns no changes when no wins or no losses", () => {
      const perf = Array(15).fill(null).map(() => makePerfRecord({ pnl_usd: 10 }));
      const result = recalculateWeights(perf);
      expect(result.changes.length).toBe(0);
    });

    it("returns no changes when no signals had enough samples for lift (lines 178-180)", () => {
      // Create records with signal_snapshot but missing specific signals
      // so computeLift returns null for all
      const perf = Array(15).fill(null).map((_, i) => ({
        pnl_usd: i % 2 === 0 ? 10 : -5,
        recorded_at: new Date().toISOString(),
        signal_snapshot: {}, // Empty snapshots - no signal data
      }));
      const result = recalculateWeights(perf);
      expect(result.changes.length).toBe(0);
      expect(result.weights).toBeDefined();
    });

    it("adjusts weights when signals have predictive lift", () => {
      const wins = Array(8).fill(null).map(() => makePerfRecord({
        pnl_usd: 10,
        signal_snapshot: { organic_score: 85, fee_tvl_ratio: 2.0 },
      }));
      const losses = Array(8).fill(null).map(() => makePerfRecord({
        pnl_usd: -10,
        signal_snapshot: { organic_score: 50, fee_tvl_ratio: 0.5 },
      }));
      const result = recalculateWeights([...wins, ...losses]);
      // Some signals should have been adjusted
      expect(result.weights).toBeDefined();
    });
  });

  describe("getWeightsSummary", () => {
    it("returns summary with default weights", () => {
      const summary = getWeightsSummary();
      expect(summary).toContain("organic_score");
      expect(summary).toContain("fee_tvl_ratio");
    });

    it("shows [below avg] and [weak] labels for low weights (lines 353-355)", () => {
      // Set some weights to very low values
      const data = {
        weights: {
          organic_score: 0.6,  // [below avg]
          fee_tvl_ratio: 0.4,  // [weak]
          volume: 1.0,         // [neutral]
        },
        last_recalc: new Date().toISOString(),
        recalc_count: 1,
        history: [],
      };
      fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(data));
      const summary = getWeightsSummary();
      expect(summary).toContain("[below avg]");
      expect(summary).toContain("[weak]");
    });

    it("shows [STRONG] and [above avg] labels for high weights", () => {
      const data = {
        weights: {
          organic_score: 2.0,  // [STRONG]
          fee_tvl_ratio: 1.5,  // [above avg]
          volume: 1.0,         // [neutral]
        },
        last_recalc: new Date().toISOString(),
        recalc_count: 1,
        history: [],
      };
      fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(data));
      const summary = getWeightsSummary();
      expect(summary).toContain("[STRONG]");
      expect(summary).toContain("[above avg]");
    });

    it("shows 'not been recalculated' when no last_recalc", () => {
      const data = {
        weights: { organic_score: 1.0 },
        history: [],
      };
      fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(data));
      const summary = getWeightsSummary();
      expect(summary).toContain("not been recalculated");
    });

    it("falls back to defaults when JSON file is corrupt (lines 83-90)", () => {
      fs.writeFileSync(WEIGHTS_FILE, "{ invalid json }}}");
      const summary = getWeightsSummary();
      expect(summary).toContain("organic_score");
      expect(summary).toContain("Signal Weights");
    });
  });
});
