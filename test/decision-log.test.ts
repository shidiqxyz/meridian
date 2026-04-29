import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { appendDecision, getRecentDecisions, getDecisionSummary } from "../src/core/state/decision-log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DECISION_LOG_FILE = path.join(__dirname, "..", "src", "decision-log.json");

function cleanDecisionLog() {
  for (let i = 0; i < 5; i++) {
    try {
      if (fs.existsSync(DECISION_LOG_FILE)) {
        fs.unlinkSync(DECISION_LOG_FILE);
      }
      break;
    } catch { /* retry */ }
  }
}

describe("decision-log.ts", () => {
  beforeEach(cleanDecisionLog);
  afterEach(cleanDecisionLog);

  describe("appendDecision", () => {
    it("appends a decision with all fields provided", () => {
      const result = appendDecision({
        type: "deploy",
        actor: "SCREENER",
        pool: "pool123",
        pool_name: "TEST/SOL",
        position: "Pos1",
        summary: "Deployed 0.5 SOL",
        reason: "High organic score and good fee/TVL ratio",
        risks: ["Low volume", "New token"],
        metrics: { fee_tvl: 1.5, organic: 85 },
        rejected: ["Bad bin step", "Low TVL"],
      });

      expect(result.id).toMatch(/^dec_\d+_[a-z0-9]{6}$/);
      expect(result.ts).toBeDefined();
      expect(result.type).toBe("deploy");
      expect(result.actor).toBe("SCREENER");
      expect(result.pool).toBe("pool123");
      expect(result.pool_name).toBe("TEST/SOL");
      expect(result.position).toBe("Pos1");
      expect(result.summary).toBe("Deployed 0.5 SOL");
      expect(result.reason).toBe("High organic score and good fee/TVL ratio");
      expect(result.risks).toEqual(["Low volume", "New token"]);
      expect(result.metrics).toEqual({ fee_tvl: 1.5, organic: 85 });
      expect(result.rejected).toEqual(["Bad bin step", "Low TVL"]);
    });

    it("uses defaults for missing fields", () => {
      const result = appendDecision({});
      expect(result.type).toBe("note");
      expect(result.actor).toBe("GENERAL");
      expect(result.pool).toBeNull();
      expect(result.pool_name).toBeNull();
      expect(result.position).toBeNull();
      expect(result.summary).toBeNull();
      expect(result.reason).toBeNull();
      expect(result.risks).toEqual([]);
      expect(result.metrics).toEqual({});
      expect(result.rejected).toEqual([]);
    });

    it("sanitizes summary to max 280 chars", () => {
      const longText = "a".repeat(500);
      const result = appendDecision({ summary: longText });
      expect(result.summary!.length).toBe(280);
    });

    it("sanitizes reason to max 500 chars", () => {
      const longText = "b".repeat(700);
      const result = appendDecision({ reason: longText });
      expect(result.reason!.length).toBe(500);
    });

    it("sanitizes risks to max 140 chars each, max 6 items", () => {
      const risks = Array(10).fill("x".repeat(200));
      const result = appendDecision({ risks });
      expect(result.risks.length).toBe(6);
      expect(result.risks[0].length).toBe(140);
    });

    it("sanitizes rejected to max 180 chars each, max 8 items", () => {
      const rejected = Array(12).fill("y".repeat(250));
      const result = appendDecision({ rejected });
      expect(result.rejected.length).toBe(8);
      expect(result.rejected[0].length).toBe(180);
    });

    it("sanitizes pool_name to max 120 chars", () => {
      const result = appendDecision({ pool_name: "x".repeat(200) });
      expect(result.pool_name!.length).toBe(120);
    });

    it("falls back pool_name from pool if pool_name not provided", () => {
      const result = appendDecision({ pool: "pool456" });
      expect(result.pool_name).toBe("pool456");
    });

    it("filters null/empty risks", () => {
      const result = appendDecision({ risks: ["valid", null, "", "also valid"] });
      expect(result.risks).toEqual(["valid", "also valid"]);
    });

    it("filters null/empty rejected", () => {
      const result = appendDecision({ rejected: ["good reason", null, "", "another"] });
      expect(result.rejected).toEqual(["good reason", "another"]);
    });

    it("handles non-array risks by defaulting to empty", () => {
      const result = appendDecision({ risks: "not an array" as unknown as unknown[] });
      expect(result.risks).toEqual([]);
    });

    it("handles non-array rejected by defaulting to empty", () => {
      const result = appendDecision({ rejected: "not an array" as unknown as unknown[] });
      expect(result.rejected).toEqual([]);
    });

    it("persists decision to file", () => {
      appendDecision({ type: "test", summary: "persist check" });
      const raw = JSON.parse(fs.readFileSync(DECISION_LOG_FILE, "utf8"));
      expect(raw.decisions.length).toBe(1);
      expect(raw.decisions[0].summary).toBe("persist check");
    });

    it("prepends new decisions (newest first)", () => {
      appendDecision({ type: "first" });
      appendDecision({ type: "second" });
      const decisions = getRecentDecisions();
      expect(decisions[0].type).toBe("second");
      expect(decisions[1].type).toBe("first");
    });

    it("enforces max 100 decisions", () => {
      for (let i = 0; i < 110; i++) {
        appendDecision({ type: `dec_${i}` });
      }
      const decisions = getRecentDecisions(200);
      expect(decisions.length).toBe(100);
      expect(decisions[0].type).toBe("dec_109");
    });

    it("generates unique IDs", () => {
      const r1 = appendDecision({});
      const r2 = appendDecision({});
      expect(r1.id).not.toBe(r2.id);
    });
  });

  describe("getRecentDecisions", () => {
    it("returns empty array when no decisions exist", () => {
      expect(getRecentDecisions()).toEqual([]);
    });

    it("respects limit parameter", () => {
      appendDecision({ type: "a" });
      appendDecision({ type: "b" });
      appendDecision({ type: "c" });
      expect(getRecentDecisions(2).length).toBe(2);
      expect(getRecentDecisions(2)[0].type).toBe("c");
    });

    it("returns all when limit exceeds count", () => {
      appendDecision({ type: "a" });
      appendDecision({ type: "b" });
      expect(getRecentDecisions(10).length).toBe(2);
    });

    it("uses default limit of 10", () => {
      for (let i = 0; i < 15; i++) appendDecision({ type: `d${i}` });
      expect(getRecentDecisions().length).toBe(10);
    });

    it("handles corrupted JSON file gracefully", () => {
      fs.writeFileSync(DECISION_LOG_FILE, "not json");
      expect(getRecentDecisions()).toEqual([]);
    });
  });

  describe("getDecisionSummary", () => {
    it("returns message when no decisions exist", () => {
      cleanDecisionLog();
      expect(getDecisionSummary()).toBe("No recent structured decisions yet.");
    });

    it("formats decision with all fields", () => {
      appendDecision({
        type: "deploy",
        actor: "SCREENER",
        pool_name: "TEST/SOL",
        summary: "Deployed position",
        reason: "Good signals",
        risks: ["Low volume"],
        rejected: ["Bad pool"],
      });
      const summary = getDecisionSummary(1);
      expect(summary).toContain("[SCREENER] DEPLOY TEST/SOL");
      expect(summary).toContain("summary: Deployed position");
      expect(summary).toContain("reason: Good signals");
      expect(summary).toContain("risks: Low volume");
      expect(summary).toContain("rejected: Bad pool");
    });

    it("falls back to pool when pool_name is null", () => {
      appendDecision({ type: "note", actor: "MANAGER", pool: "pool789" });
      const summary = getDecisionSummary();
      expect(summary).toContain("pool789");
    });

    it("uses 'unknown pool' when both pool and pool_name are null", () => {
      appendDecision({ type: "note" });
      const summary = getDecisionSummary();
      expect(summary).toContain("unknown pool");
    });

    it("omits optional fields when not present", () => {
      cleanDecisionLog();
      appendDecision({ type: "note", actor: "GENERAL", pool_name: "POOL" });
      const summary = getDecisionSummary();
      expect(summary).not.toContain("summary:");
      expect(summary).not.toContain("reason:");
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 10; i++) appendDecision({ type: `t${i}`, pool_name: `POOL${i}` });
      const summary = getDecisionSummary(3);
      const lines = summary.split("\n");
      expect(lines.length).toBe(3);
      expect(lines[0]).toContain("POOL9");
    });

    it("uses default limit of 6", () => {
      for (let i = 0; i < 10; i++) appendDecision({ type: `t${i}`, pool_name: `POOL${i}` });
      const summary = getDecisionSummary();
      const lines = summary.split("\n");
      expect(lines.length).toBe(6);
    });
  });
});
