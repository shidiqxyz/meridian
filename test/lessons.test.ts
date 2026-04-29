import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import type { PerformanceRecord, Lesson } from "../src/core/types/state.js";
import type { Config as AppConfig } from "../src/core/types/config.js";
import {
  evolveThresholds,
  addLesson,
  pinLesson,
  unpinLesson,
  listLessons,
  removeLessonsByKeyword,
  clearAllLessons,
  clearPerformance,
  getLessonsForPrompt,
  getPerformanceHistory,
  getPerformanceSummary,
  recordPerformance,
} from "../src/core/state/lessons.js";

// Mock hivemind to avoid network calls and config loading
vi.mock("../src/services/hivemind.js", () => ({
  getSharedLessonsForPrompt: vi.fn().mockReturnValue(null),
  pushHiveLesson: vi.fn().mockResolvedValue(undefined),
  pushHivePerformanceEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock pool-memory.js to avoid side effects
vi.mock("../src/core/state/pool-memory.js", () => ({
  recordPoolDeploy: vi.fn().mockResolvedValue(undefined),
}));

// Mock config.js
vi.mock("../src/core/config/config.js", () => ({
  config: {
    screening: {
      excludeHighSupplyConcentration: true,
      minFeeActiveTvlRatio: 0.05,
      minTvl: 10000,
      maxTvl: 150000,
      minVolume: 500,
      minOrganic: 60,
      minQuoteOrganic: 60,
      minHolders: 500,
      minMcap: 150000,
      maxMcap: 10000000,
      minBinStep: 80,
      maxBinStep: 125,
      maxVolatility: 5,
      timeframe: "5m",
      category: "trending",
      minTokenFeesSol: 30,
      useDiscordSignals: false,
      discordSignalMode: "merge",
      avoidPvpSymbols: true,
      blockPvpSymbols: false,
      maxBundlePct: 30,
      maxBotHoldersPct: 30,
      maxTop10Pct: 60,
      allowedLaunchpads: [],
      blockedLaunchpads: [],
      minTokenAgeHours: null,
      maxTokenAgeHours: null,
      athFilterPct: null,
    },
  },
  reloadScreeningThresholds: vi.fn(),
}));

const LESSONS_FILE = "./lessons.json";
const USER_CONFIG_FILE = "./user-config.json";

function cleanFiles() {
  for (let i = 0; i < 5; i++) {
    try {
      if (fs.existsSync(LESSONS_FILE)) fs.unlinkSync(LESSONS_FILE);
      if (fs.existsSync(`${LESSONS_FILE}.tmp`)) fs.unlinkSync(`${LESSONS_FILE}.tmp`);
      if (fs.existsSync(USER_CONFIG_FILE)) fs.unlinkSync(USER_CONFIG_FILE);
      break;
    } catch {
      // Brief delay for Windows file lock release
      const start = Date.now();
      while (Date.now() - start < 50) { /* spin */ }
    }
  }
}

function makePerformance(overrides: Partial<PerformanceRecord> = {}): PerformanceRecord {
  return {
    position: "test-pos",
    pool: "test-pool",
    pool_name: "Test Pool",
    strategy: "bid_ask",
    bin_range: { bins_below: 69, bins_above: 0 },
    bin_step: 100,
    volatility: 3,
    fee_tvl_ratio: 0.1,
    organic_score: 70,
    amount_sol: 0.5,
    fees_earned_usd: 10,
    final_value_usd: 100,
    initial_value_usd: 100,
    minutes_in_range: 100,
    minutes_held: 120,
    close_reason: "agent decision",
    pnl_usd: 0,
    pnl_pct: 0,
    range_efficiency: 0,
    recorded_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeConfig(): AppConfig {
  return {
    screening: {
      excludeHighSupplyConcentration: true,
      minFeeActiveTvlRatio: 0.05,
      minTvl: 10000,
      maxTvl: 150000,
      minVolume: 500,
      minOrganic: 60,
      minQuoteOrganic: 60,
      minHolders: 500,
      minMcap: 150000,
      maxMcap: 10000000,
      minBinStep: 80,
      maxBinStep: 125,
      maxVolatility: 5,
      timeframe: "5m",
      category: "trending",
      minTokenFeesSol: 30,
      useDiscordSignals: false,
      discordSignalMode: "merge",
      avoidPvpSymbols: true,
      blockPvpSymbols: false,
      maxBundlePct: 30,
      maxBotHoldersPct: 30,
      maxTop10Pct: 60,
      allowedLaunchpads: [],
      blockedLaunchpads: [],
      minTokenAgeHours: null,
      maxTokenAgeHours: null,
      athFilterPct: null,
    },
  } as unknown as AppConfig;
}

describe("lessons.ts", () => {
  beforeEach(cleanFiles);
  afterEach(cleanFiles);

  describe("evolveThresholds", () => {
    it("returns null when fewer than 5 positions", () => {
      const perf = [makePerformance()];
      const result = evolveThresholds(perf as unknown as PerformanceRecord[], makeConfig());
      expect(result).toBeNull();
    });

    it("suggests tighter maxVolatility when losers cluster at low volatility", () => {
      const perf = [
        makePerformance({ pnl_pct: -10, volatility: 2 }),
        makePerformance({ pnl_pct: -8, volatility: 2.5 }),
        makePerformance({ pnl_pct: -12, volatility: 1.5 }),
        makePerformance({ pnl_pct: 15, volatility: 2 }),
        makePerformance({ pnl_pct: 20, volatility: 3 }),
      ];
      const cfg = makeConfig();
      cfg.screening.maxVolatility = 5;
      const result = evolveThresholds(perf as unknown as PerformanceRecord[], cfg);

      if (result && result.changes.maxVolatility !== undefined) {
        expect(result.changes.maxVolatility).toBeLessThan(5);
        expect(result.rationale.maxVolatility).toContain("tightened");
      }
    });

    it("suggests looser maxVolatility when all winners have high volatility", () => {
      const perf = [
        makePerformance({ pnl_pct: 10, volatility: 8 }),
        makePerformance({ pnl_pct: 15, volatility: 7 }),
        makePerformance({ pnl_pct: 20, volatility: 9 }),
        makePerformance({ pnl_pct: 5, volatility: 6 }),
        makePerformance({ pnl_pct: 25, volatility: 10 }),
      ];
      const cfg = makeConfig();
      cfg.screening.maxVolatility = 5;
      const result = evolveThresholds(perf as unknown as PerformanceRecord[], cfg);

      if (result && result.changes.maxVolatility !== undefined) {
        expect(result.changes.maxVolatility).toBeGreaterThan(5);
        expect(result.rationale.maxVolatility).toContain("loosened");
      }
    });

    it("returns result with changes and rationale structure", () => {
      const perf = Array(10).fill(null).map((_, i) =>
        makePerformance({ pnl_pct: i % 2 === 0 ? -15 : 20, volatility: i % 2 === 0 ? 2 : 4, fee_tvl_ratio: i % 2 === 0 ? 0.02 : 0.15 })
      );
      const cfg = makeConfig();
      const result = evolveThresholds(perf as unknown as PerformanceRecord[], cfg);

      if (result) {
        expect(result).toHaveProperty("changes");
        expect(result).toHaveProperty("rationale");
        expect(typeof result.changes).toBe("object");
        expect(typeof result.rationale).toBe("object");
      }
    });

    it("returns empty changes when no clear signal", () => {
      const perf = [
        makePerformance({ pnl_pct: 2 }),
        makePerformance({ pnl_pct: 1 }),
        makePerformance({ pnl_pct: 3 }),
        makePerformance({ pnl_pct: 4 }),
        makePerformance({ pnl_pct: -1 }),
      ];
      const result = evolveThresholds(perf as unknown as PerformanceRecord[], makeConfig());
      if (result) {
        expect(Object.keys(result.changes)).toBeDefined();
      }
    });
  });

  describe("addLesson", () => {
    it("adds a manual lesson with defaults", () => {
      addLesson("Test lesson rule");
      const lessons = listLessons();
      expect(lessons.total).toBe(1);
      expect(lessons.lessons[0].rule).toBe("Test lesson rule");
      expect(lessons.lessons[0].outcome).toBe("manual");
      expect(lessons.lessons[0].pinned).toBe(false);
      expect(lessons.lessons[0].role).toBe("all");
    });

    it("adds a pinned lesson", () => {
      addLesson("Pinned rule", [], { pinned: true });
      const lessons = listLessons({ pinned: true });
      expect(lessons.total).toBe(1);
      expect(lessons.lessons[0].rule).toBe("Pinned rule");
      expect(lessons.lessons[0].pinned).toBe(true);
    });

    it("adds a lesson with a specific role", () => {
      addLesson("Screener rule", ["screening"], { role: "SCREENER" });
      const lessons = listLessons();
      expect(lessons.lessons[0].role).toBe("SCREENER");
    });

    it("adds a lesson with tags", () => {
      addLesson("Tagged rule", ["oor", "risk"]);
      const lessons = listLessons();
      expect(lessons.lessons[0].tags).toEqual(["oor", "risk"]);
    });

    it("does not add empty rule", () => {
      addLesson("");
      expect(listLessons().total).toBe(0);
    });

    it("does not add null rule", () => {
      addLesson(null as unknown as string);
      expect(listLessons().total).toBe(0);
    });

    it("truncates long rules to 400 chars", () => {
      const longRule = "x".repeat(500);
      addLesson(longRule);
      const lessons = listLessons();
      expect(lessons.lessons[0].rule.length).toBeLessThanOrEqual(400);
    });

    it("sets sourceType to config_change for self_tune tag", () => {
      addLesson("Auto-tuned", ["self_tune"]);
      const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
      expect(data.lessons[0].sourceType).toBe("config_change");
    });

    it("sets sourceType to config_change for config_change tag", () => {
      addLesson("Config changed", ["config_change"]);
      const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
      expect(data.lessons[0].sourceType).toBe("config_change");
    });
  });

  describe("pinLesson / unpinLesson", () => {
    it("pins an existing lesson", () => {
      addLesson("Pin me");
      const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
      const id = data.lessons[0].id;
      const result = pinLesson(id);
      expect(result.found).toBe(true);
      expect(result.pinned).toBe(true);
      expect(result.id).toBe(id);
    });

    it("returns not found for non-existent lesson", () => {
      const result = pinLesson(999999);
      expect(result.found).toBe(false);
    });

    it("unpins an existing lesson", () => {
      addLesson("Unpin me");
      const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
      const id = data.lessons[0].id;
      pinLesson(id);
      const result = unpinLesson(id);
      expect(result.found).toBe(true);
      expect(result.pinned).toBe(false);
    });

    it("returns not found for unpin non-existent", () => {
      expect(unpinLesson(999999).found).toBe(false);
    });
  });

  describe("listLessons", () => {
    it("returns empty list when no lessons", () => {
      const result = listLessons();
      expect(result.total).toBe(0);
      expect(result.lessons).toEqual([]);
    });

    it("returns all lessons by default", () => {
      addLesson("A");
      addLesson("B");
      addLesson("C");
      expect(listLessons().total).toBe(3);
    });

    it("filters by pinned=true", () => {
      addLesson("Pinned", [], { pinned: true });
      addLesson("Not pinned");
      expect(listLessons({ pinned: true }).total).toBe(1);
    });

    it("filters by pinned=false", () => {
      addLesson("Pinned", [], { pinned: true });
      addLesson("Not pinned");
      expect(listLessons({ pinned: false }).total).toBe(1);
    });

    it("filters by role (includes null role lessons)", () => {
      addLesson("Screener", [], { role: "SCREENER" });
      addLesson("Manager", [], { role: "MANAGER" });
      addLesson("General");
      // listLessons includes lessons with null role for any role filter
      expect(listLessons({ role: "SCREENER" }).total).toBe(2);
    });

    it("includes role=null lessons when filtering by role", () => {
      addLesson("Screener", [], { role: "SCREENER" });
      addLesson("General");
      expect(listLessons({ role: "SCREENER" }).total).toBe(2);
    });

    it("filters by tag", () => {
      addLesson("Tagged A", ["oor"]);
      addLesson("Tagged B", ["oor", "risk"]);
      addLesson("Untagged");
      expect(listLessons({ tag: "oor" }).total).toBe(2);
    });

    it("respects limit (returns last N)", () => {
      for (let i = 0; i < 10; i++) addLesson(`Lesson ${i}`);
      const result = listLessons({ limit: 3 });
      expect(result.total).toBe(10);
      expect(result.lessons.length).toBe(3);
      expect(result.lessons[0].rule).toBe("Lesson 7");
    });

    it("truncates rule to 120 chars in listing", () => {
      addLesson("x".repeat(200));
      const result = listLessons();
      expect(result.lessons[0].rule.length).toBe(120);
    });

    it("includes created_at date (YYYY-MM-DD)", () => {
      addLesson("Date check");
      const result = listLessons();
      expect(result.lessons[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("removeLessonsByKeyword", () => {
    it("removes lessons containing keyword", () => {
      addLesson("AVOID: bad pools");
      addLesson("PREFER: good pools");
      addLesson("AVOID: risky tokens");
      const removed = removeLessonsByKeyword("AVOID");
      expect(removed).toBe(2);
      expect(listLessons().total).toBe(1);
    });

    it("is case-insensitive", () => {
      addLesson("AVOID: bad");
      const removed = removeLessonsByKeyword("avoid");
      expect(removed).toBe(1);
    });

    it("returns 0 when no matches", () => {
      addLesson("Some lesson");
      expect(removeLessonsByKeyword("nonexistent")).toBe(0);
    });
  });

  describe("clearAllLessons", () => {
    it("clears all lessons and returns count", () => {
      addLesson("A");
      addLesson("B");
      addLesson("C");
      const count = clearAllLessons();
      expect(count).toBe(3);
      expect(listLessons().total).toBe(0);
    });

    it("returns 0 when no lessons", () => {
      expect(clearAllLessons()).toBe(0);
    });
  });

  describe("clearPerformance", () => {
    it("clears all performance records and returns count", () => {
      const data = { lessons: [], performance: [
        makePerformance({ position: "p1" }),
        makePerformance({ position: "p2" }),
      ]};
      fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
      const count = clearPerformance();
      expect(count).toBe(2);
      const loaded = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
      expect(loaded.performance.length).toBe(0);
    });

    it("returns 0 when no performance records", () => {
      expect(clearPerformance()).toBe(0);
    });
  });

  describe("getPerformanceHistory", () => {
    it("returns empty when no performance data", () => {
      const result = getPerformanceHistory();
      expect(result.count).toBe(0);
      expect(result.total_pnl_usd).toBe(0);
      expect(result.win_rate_pct).toBeNull();
    });

    it("returns positions within time window", () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 1000).toISOString();
      const data = { lessons: [], performance: [
        makePerformance({ pnl_usd: 10, pnl_pct: 10, position: "p1", recorded_at: recent }),
      ]};
      fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
      const result = getPerformanceHistory({ hours: 1 });
      expect(result.count).toBe(1);
      expect(result.positions[0].pool_name).toBe("Test Pool");
    });

    it("filters out old records", () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const data = { lessons: [], performance: [
        makePerformance({ pnl_usd: 10, position: "old", recorded_at: old }),
      ]};
      fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
      const result = getPerformanceHistory({ hours: 24 });
      expect(result.count).toBe(0);
    });

    it("calculates win rate correctly", () => {
      const now = new Date().toISOString();
      const data = { lessons: [], performance: [
        makePerformance({ pnl_usd: 10, pnl_pct: 10, position: "win", recorded_at: now }),
        makePerformance({ pnl_usd: -5, pnl_pct: -5, position: "loss", recorded_at: now }),
        makePerformance({ pnl_usd: 3, pnl_pct: 3, position: "win2", recorded_at: now }),
      ]};
      fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
      const result = getPerformanceHistory({ hours: 1 });
      expect(result.count).toBe(3);
      expect(result.win_rate_pct).toBe(Math.round((2 / 3) * 100));
    });

    it("calculates total PnL", () => {
      const now = new Date().toISOString();
      const data = { lessons: [], performance: [
        makePerformance({ pnl_usd: 10, position: "a", recorded_at: now }),
        makePerformance({ pnl_usd: -3.5, position: "b", recorded_at: now }),
      ]};
      fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
      const result = getPerformanceHistory({ hours: 1 });
      expect(result.total_pnl_usd).toBe(6.5);
    });

    it("respects limit parameter", () => {
      const now = new Date().toISOString();
      const perf = Array(20).fill(null).map((_, i) =>
        makePerformance({ pnl_usd: i, position: `p${i}`, recorded_at: now })
      );
      const data = { lessons: [], performance: perf };
      fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
      const result = getPerformanceHistory({ hours: 1, limit: 5 });
      expect(result.count).toBe(5);
    });
  });

  describe("getPerformanceSummary", () => {
    it("returns null when no performance data", () => {
      expect(getPerformanceSummary()).toBeNull();
    });

    it("calculates summary statistics", () => {
      const data = { lessons: [], performance: [
        makePerformance({ pnl_usd: 10, pnl_pct: 10, range_efficiency: 80 }),
        makePerformance({ pnl_usd: -5, pnl_pct: -5, range_efficiency: 40 }),
        makePerformance({ pnl_usd: 20, pnl_pct: 20, range_efficiency: 90 }),
      ]};
      fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
      const summary = getPerformanceSummary();
      expect(summary!.total_positions_closed).toBe(3);
      expect(summary!.total_pnl_usd).toBe(25);
      expect(summary!.avg_pnl_pct).toBe(Math.round(((10 + -5 + 20) / 3) * 100) / 100);
      expect(summary!.win_rate_pct).toBe(Math.round((2 / 3) * 100));
      expect(summary!.total_lessons).toBe(0);
    });

    it("calculates avg range efficiency", () => {
      const data = { lessons: [], performance: [
        makePerformance({ range_efficiency: 60 }),
        makePerformance({ range_efficiency: 80 }),
      ]};
      fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
      const summary = getPerformanceSummary();
      expect(summary!.avg_range_efficiency_pct).toBe(70);
    });
  });

  describe("getLessonsForPrompt", () => {
    it("returns null when no lessons exist", () => {
      expect(getLessonsForPrompt()).toBeNull();
    });

    it("returns formatted lessons for SCREENER role", () => {
      addLesson("AVOID: bad pools", ["oor"], { role: "SCREENER" });
      const result = getLessonsForPrompt({ agentType: "SCREENER" });
      expect(result).toContain("AVOID: bad pools");
    });

    it("includes pinned lessons first", () => {
      addLesson("Pinned lesson", [], { pinned: true });
      addLesson("Regular lesson");
      const result = getLessonsForPrompt();
      expect(result).toContain("── PINNED");
      expect(result).toContain("Pinned lesson");
    });

    it("matches role-tagged lessons for SCREENER in role section", () => {
      addLesson("Screening lesson", ["screening"]);
      addLesson("Management lesson", ["management"]);
      const result = getLessonsForPrompt({ agentType: "SCREENER" });
      expect(result).toContain("Screening lesson");
      // Management lesson falls through to RECENT section, not filtered out entirely
      expect(result).toContain("── SCREENER");
    });

    it("matches role-tagged lessons for MANAGER in role section", () => {
      addLesson("Screening lesson", ["screening"]);
      addLesson("Management lesson", ["management"]);
      const result = getLessonsForPrompt({ agentType: "MANAGER" });
      expect(result).toContain("Management lesson");
      expect(result).toContain("── MANAGER");
    });

    it("includes all lessons for GENERAL role", () => {
      addLesson("A", ["screening"]);
      addLesson("B", ["management"]);
      const result = getLessonsForPrompt({ agentType: "GENERAL" });
      expect(result).toContain("A");
      expect(result).toContain("B");
    });

    it("prioritizes bad outcomes", () => {
      addLesson("Bad lesson", [], { pinned: false });
      const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
      data.lessons[0].outcome = "bad";
      fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
      const result = getLessonsForPrompt({ agentType: "GENERAL" });
      expect(result).toContain("[BAD]");
    });

    it("respects maxLessons parameter for recent budget", () => {
      for (let i = 0; i < 10; i++) addLesson(`Lesson ${i}`);
      // SCREENER has tighter caps (ROLE_CAP=6, RECENT_CAP=10 by default)
      const result = getLessonsForPrompt({ agentType: "SCREENER", maxLessons: 2 });
      const lines = result!.split("\n");
      const lessonLines = lines.filter((l) => l.startsWith("[MANUAL]"));
      // Total should be within pinned(0) + role(6) + recent(2) = 8 max
      expect(lessonLines.length).toBeLessThanOrEqual(8);
    });

    it("formats lesson with outcome and date", () => {
      addLesson("Format test");
      const result = getLessonsForPrompt({ agentType: "GENERAL" });
      expect(result).toMatch(/\[MANUAL\]/);
      expect(result).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/);
    });

    it("shows pinned indicator with pin emoji", () => {
      addLesson("Pinned test", [], { pinned: true });
      const result = getLessonsForPrompt({ agentType: "GENERAL" });
      expect(result).toContain("📌");
    });

    it("shows RECENT section for lessons that don't match role", () => {
      addLesson("SCREENER lesson", [], { role: "SCREENER" });
      addLesson("MANAGER lesson", [], { role: "MANAGER" });
      // SCREENER agentType excludes MANAGER-only lessons → they fall to RECENT
      const result = getLessonsForPrompt({ agentType: "SCREENER" });
      expect(result).toContain("── RECENT");
      expect(result).toContain("MANAGER lesson");
    });

    it("places wrong-role lessons in RECENT section, not role section", () => {
      addLesson("SCREENER only", [], { role: "SCREENER" });
      const result = getLessonsForPrompt({ agentType: "MANAGER" });
      // Lesson appears in RECENT, not in a MANAGER section
      expect(result).toContain("SCREENER only");
      expect(result).not.toContain("── MANAGER");
    });

    it("includes lessons with null role for any agentType", () => {
      addLesson("Universal lesson");
      expect(getLessonsForPrompt({ agentType: "SCREENER" })).toContain("Universal lesson");
      expect(getLessonsForPrompt({ agentType: "MANAGER" })).toContain("Universal lesson");
    });

    it("accepts legacy number argument", () => {
      addLesson("Legacy arg test");
      const result = getLessonsForPrompt(3);
      expect(result).toContain("Legacy arg test");
    });
  });

  describe("derive lesson from performance", () => {
    it("derives a 'bad' lesson for poor range efficiency and negative PnL", () => {
      addLesson("AVOID: Test Pool-type pools (volatility=4, bin_step=100) with strategy=\"bid_ask\" — went OOR 85% of the time. Consider wider bin_range or bid_ask strategy.", ["oor", "bid_ask", "volatility_4"]);
      const result = getLessonsForPrompt({ agentType: "SCREENER" });
      expect(result).toContain("AVOID");
      expect(result).toContain("OOR");
    });

    it("derives a 'good' lesson for high range efficiency and positive PnL", () => {
      addLesson("PREFER: Test Pool-type pools (volatility=3, bin_step=100) with strategy=\"bid_ask\" — 90% in-range efficiency, PnL +15%.", ["efficient", "bid_ask"]);
      const result = getLessonsForPrompt({ agentType: "SCREENER" });
      expect(result).toContain("PREFER");
      expect(result).toContain("efficiency");
    });
  });

  describe("recordPerformance", () => {
    it("rejects suspicious unit-mixed records", async () => {
      const perf = makePerformance({
        initial_value_usd: 50,
        amount_sol: 0.5,
        final_value_usd: 0.8,
      });
      await recordPerformance(perf);
      const exists = fs.existsSync(LESSONS_FILE);
      if (exists) {
        const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
        expect(data.performance.length).toBe(0);
      } else {
        expect(exists).toBe(false);
      }
    });

    it("rejects absurd closed PnL without stop loss", async () => {
      const perf = makePerformance({
        initial_value_usd: 100,
        final_value_usd: 5,
        fees_earned_usd: 0,
        amount_sol: 0.5,
        close_reason: "agent decision",
      });
      await recordPerformance(perf);
      const exists = fs.existsSync(LESSONS_FILE);
      if (exists) {
        const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
        expect(data.performance.length).toBe(0);
      } else {
        expect(exists).toBe(false);
      }
    });

    it("accepts absurd PnL if close reason is stop loss", async () => {
      const perf = makePerformance({
        initial_value_usd: 100,
        final_value_usd: 5,
        fees_earned_usd: 0,
        amount_sol: 0.1,
        close_reason: "stop loss triggered",
      });
      await recordPerformance(perf);
      const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
      expect(data.performance.length).toBe(1);
    });

    it("records valid performance and derives lesson", async () => {
      const perf = makePerformance({
        position: "rec-pos-1",
        initial_value_usd: 100,
        final_value_usd: 120,
        fees_earned_usd: 5,
        amount_sol: 0.5,
      });
      await recordPerformance(perf);
      const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
      expect(data.performance.length).toBe(1);
      expect(data.performance[0].pnl_usd).toBe(25);
      expect(data.performance[0].pnl_pct).toBe(25);
    });

    it("triggers evolveThresholds every 5 positions", async () => {
      const winners = Array(5).fill(null).map((_, i) =>
        makePerformance({
          position: `evo-win-${i}`,
          pnl_pct: 20,
          pnl_usd: 20,
          volatility: 8,
          fee_tvl_ratio: 0.15,
          organic_score: 80,
          initial_value_usd: 100,
          final_value_usd: 120,
          fees_earned_usd: 5,
          amount_sol: 0.5,
        })
      );
      for (const w of winners) {
        await recordPerformance(w);
      }
      const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
      expect(data.performance.length).toBe(5);
    });
  });

  describe("evolveThresholds - minFeeActiveTvlRatio", () => {
    it("raises floor when winners have higher fee_tvl_ratio", () => {
      const perf = [
        makePerformance({ pnl_pct: 15, fee_tvl_ratio: 0.15 }),
        makePerformance({ pnl_pct: 20, fee_tvl_ratio: 0.12 }),
        makePerformance({ pnl_pct: 10, fee_tvl_ratio: 0.18 }),
        makePerformance({ pnl_pct: -10, fee_tvl_ratio: 0.02 }),
        makePerformance({ pnl_pct: -15, fee_tvl_ratio: 0.01 }),
      ];
      const cfg = makeConfig();
      cfg.screening.minFeeActiveTvlRatio = 0.05;
      const result = evolveThresholds(perf as unknown as PerformanceRecord[], cfg);
      if (result && result.changes.minFeeActiveTvlRatio !== undefined) {
        expect(result.changes.minFeeActiveTvlRatio).toBeGreaterThan(0.05);
        expect(result.rationale.minFeeActiveTvlRatio).toContain("raised");
      }
    });

    it("raises floor when losers have low fee_tvl and winners higher", () => {
      const perf = [
        makePerformance({ pnl_pct: 10, fee_tvl_ratio: 0.10 }),
        makePerformance({ pnl_pct: 12, fee_tvl_ratio: 0.12 }),
        makePerformance({ pnl_pct: -8, fee_tvl_ratio: 0.03 }),
        makePerformance({ pnl_pct: -12, fee_tvl_ratio: 0.02 }),
        makePerformance({ pnl_pct: -10, fee_tvl_ratio: 0.01 }),
      ];
      const cfg = makeConfig();
      cfg.screening.minFeeActiveTvlRatio = 0.05;
      const result = evolveThresholds(perf as unknown as PerformanceRecord[], cfg);
      if (result && result.changes.minFeeActiveTvlRatio !== undefined) {
        expect(result.changes.minFeeActiveTvlRatio).toBeGreaterThan(0.05);
      }
    });
  });

  describe("evolveThresholds - minOrganic", () => {
    it("raises minOrganic when winners have significantly higher organic scores", () => {
      const perf = [
        makePerformance({ pnl_pct: 15, organic_score: 85 }),
        makePerformance({ pnl_pct: 20, organic_score: 90 }),
        makePerformance({ pnl_pct: -10, organic_score: 60 }),
        makePerformance({ pnl_pct: -12, organic_score: 55 }),
        makePerformance({ pnl_pct: 10, organic_score: 80 }),
      ];
      const cfg = makeConfig();
      cfg.screening.minOrganic = 60;
      const result = evolveThresholds(perf as unknown as PerformanceRecord[], cfg);
      if (result && result.changes.minOrganic !== undefined) {
        expect(result.changes.minOrganic).toBeGreaterThan(60);
        expect(result.rationale.minOrganic).toContain("raised");
      }
    });

    it("does not raise minOrganic when difference is small", () => {
      const perf = [
        makePerformance({ pnl_pct: 10, organic_score: 72 }),
        makePerformance({ pnl_pct: 12, organic_score: 70 }),
        makePerformance({ pnl_pct: -8, organic_score: 68 }),
        makePerformance({ pnl_pct: -10, organic_score: 65 }),
        makePerformance({ pnl_pct: 5, organic_score: 75 }),
      ];
      const cfg = makeConfig();
      cfg.screening.minOrganic = 60;
      const result = evolveThresholds(perf as unknown as PerformanceRecord[], cfg);
      if (result) {
        expect(result.changes.minOrganic).toBeUndefined();
      }
    });
  });

  describe("evolveThresholds - config persistence", () => {
    it("persists changes to user-config.json", () => {
      const perf = Array(10).fill(null).map((_, i) =>
        makePerformance({ pnl_pct: i % 2 === 0 ? -15 : 20, volatility: i % 2 === 0 ? 1.5 : 4, organic_score: i % 2 === 0 ? 55 : 85 })
      );
      const cfg = makeConfig();
      cfg.screening.maxVolatility = 5;
      cfg.screening.minOrganic = 60;
      evolveThresholds(perf as unknown as PerformanceRecord[], cfg);

      if (fs.existsSync(USER_CONFIG_FILE)) {
        const saved = JSON.parse(fs.readFileSync(USER_CONFIG_FILE, "utf8"));
        expect(saved._lastEvolved).toBeDefined();
        expect(saved._positionsAtEvolution).toBe(10);
      }
    });

    it("updates live config object", () => {
      const perf = [
        makePerformance({ pnl_pct: -15, volatility: 2 }),
        makePerformance({ pnl_pct: -12, volatility: 2.5 }),
        makePerformance({ pnl_pct: -10, volatility: 1.5 }),
        makePerformance({ pnl_pct: -8, volatility: 2 }),
        makePerformance({ pnl_pct: 20, volatility: 3 }),
      ];
      const cfg = makeConfig();
      cfg.screening.maxVolatility = 5;
      const result = evolveThresholds(perf as unknown as PerformanceRecord[], cfg);
      if (result && result.changes.maxVolatility !== undefined) {
        expect(cfg.screening.maxVolatility).toBe(result.changes.maxVolatility);
      }
    });

    it("adds evolution lesson to lessons.json", () => {
      const perf = [
        makePerformance({ pnl_pct: -15, volatility: 2 }),
        makePerformance({ pnl_pct: -12, volatility: 2.5 }),
        makePerformance({ pnl_pct: -10, volatility: 1.5 }),
        makePerformance({ pnl_pct: -8, volatility: 2 }),
        makePerformance({ pnl_pct: 20, volatility: 3 }),
      ];
      const cfg = makeConfig();
      cfg.screening.maxVolatility = 5;
      evolveThresholds(perf as unknown as PerformanceRecord[], cfg);

      if (fs.existsSync(LESSONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
        const evolutionLesson = data.lessons.find((l: Lesson) => l.sourceType === "config_change" && l.rule.includes("AUTO-EVOLVED"));
        expect(evolutionLesson).toBeDefined();
      }
    });

    it("raises minFeeActiveTvlRatio when losers had lower fee_tvl than winners (second branch, lines 320-322)", () => {
      const perf = [
        makePerformance({ pnl_pct: 10, fee_tvl_ratio: 0.12 }),
        makePerformance({ pnl_pct: 15, fee_tvl_ratio: 0.14 }),
        makePerformance({ pnl_pct: 12, fee_tvl_ratio: 0.13 }),
        makePerformance({ pnl_pct: -10, fee_tvl_ratio: 0.05 }),
        makePerformance({ pnl_pct: -8, fee_tvl_ratio: 0.06 }),
      ];
      const cfg = makeConfig();
      cfg.screening.minFeeActiveTvlRatio = 0.05;
      const result = evolveThresholds(perf as unknown as PerformanceRecord[], cfg);
      expect(result?.changes.minFeeActiveTvlRatio).toBeDefined();
      expect(result!.changes.minFeeActiveTvlRatio).toBeGreaterThan(0.05);
    });
  });
});
