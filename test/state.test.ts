import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from "vitest";
import fs from "fs";
import {
  trackPosition,
  markOutOfRange,
  markInRange,
  minutesOutOfRange,
  recordClaim,
  recordClose,
  setPositionInstruction,
  queuePeakConfirmation,
  resolvePendingPeak,
  queueTrailingDropConfirmation,
  resolvePendingTrailingDrop,
  getTrackedPosition,
  getStateSummary,
  updatePnlAndCheckExits,
  syncOpenPositions,
  getLastBriefingDate,
  setLastBriefingDate,
} from "../src/core/state/state.js";

const STATE_FILE = "./state.json";

function cleanState() {
  // Retry cleanup to handle Windows file locks
  for (let i = 0; i < 3; i++) {
    try {
      fs.unlinkSync(STATE_FILE);
      break;
    } catch { /* retry */ }
  }
  for (let i = 0; i < 3; i++) {
    try {
      fs.unlinkSync(`${STATE_FILE}.tmp`);
      break;
    } catch { /* retry */ }
  }
}

const defaultPos = {
  position: "Pos1",
  pool: "Pool1",
  pool_name: "TEST/SOL",
  strategy: "wide",
  amount_sol: 0.5,
  active_bin: 100,
  bin_step: 100,
  volatility: 2,
  fee_tvl_ratio: 1.5,
  organic_score: 80,
  initial_value_usd: 100,
};

describe("state.ts", () => {
  beforeEach(cleanState);
  afterEach(() => {
    cleanState();
    vi.useRealTimers();
  });

  describe("trackPosition", () => {
    it("creates a new position with all fields", () => {
      trackPosition(defaultPos);
      const pos = getTrackedPosition("Pos1");
      expect(pos).not.toBeNull();
      expect(pos!.pool).toBe("Pool1");
      expect(pos!.amount_sol).toBe(0.5);
      expect(pos!.amount_x).toBe(0);
      expect(pos!.active_bin_at_deploy).toBe(100);
      expect(pos!.bin_step).toBe(100);
      expect(pos!.volatility).toBe(2);
      expect(pos!.fee_tvl_ratio).toBe(1.5);
      expect(pos!.organic_score).toBe(80);
      expect(pos!.initial_value_usd).toBe(100);
      expect(pos!.signal_snapshot).toBeNull();
      expect(pos!.deployed_at).toBeDefined();
      expect(pos!.out_of_range_since).toBeNull();
      expect(pos!.last_claim_at).toBeNull();
      expect(pos!.total_fees_claimed_usd).toBe(0);
      expect(pos!.rebalance_count).toBe(0);
      expect(pos!.closed).toBe(false);
      expect(pos!.closed_at).toBeNull();
      expect(pos!.notes).toEqual([]);
      expect(pos!.peak_pnl_pct).toBe(0);
      expect(pos!.pending_peak_pnl_pct).toBeNull();
      expect(pos!.trailing_active).toBe(false);
    });

    it("sets amount_x when provided", () => {
      trackPosition({ ...defaultPos, amount_x: 500 });
      const pos = getTrackedPosition("Pos1");
      expect(pos!.amount_x).toBe(500);
    });

    it("sets bin_range when provided", () => {
      trackPosition({ ...defaultPos, bin_range: { bins_below: 40, bins_above: 20 } });
      const pos = getTrackedPosition("Pos1");
      expect(pos!.bin_range).toEqual({ bins_below: 40, bins_above: 20 });
    });

    it("sets signal_snapshot when provided", () => {
      const snap = { organic_score: 85, volume: "high" };
      trackPosition({ ...defaultPos, signal_snapshot: snap });
      const pos = getTrackedPosition("Pos1");
      expect(pos!.signal_snapshot).toEqual(snap);
    });

    it("tracks multiple positions", () => {
      trackPosition(defaultPos);
      trackPosition({ ...defaultPos, position: "Pos2", pool: "Pool2" });
      expect(getTrackedPosition("Pos1")).not.toBeNull();
      expect(getTrackedPosition("Pos2")).not.toBeNull();
    });
  });

  describe("out of range tracking", () => {
    it("marks position out of range", () => {
      trackPosition(defaultPos);
      markOutOfRange("Pos1");
      const pos = getTrackedPosition("Pos1");
      expect(pos!.out_of_range_since).toBeDefined();
    });

    it("does not overwrite existing out_of_range_since", () => {
      vi.useFakeTimers();
      trackPosition(defaultPos);
      markOutOfRange("Pos1");
      const first = getTrackedPosition("Pos1")!.out_of_range_since;
      vi.advanceTimersByTime(60000);
      markOutOfRange("Pos1");
      expect(getTrackedPosition("Pos1")!.out_of_range_since).toBe(first);
    });

    it("marks position back in range", () => {
      trackPosition(defaultPos);
      markOutOfRange("Pos1");
      markInRange("Pos1");
      expect(getTrackedPosition("Pos1")!.out_of_range_since).toBeNull();
    });

    it("does nothing when already in range", () => {
      trackPosition(defaultPos);
      markInRange("Pos1");
      expect(getTrackedPosition("Pos1")!.out_of_range_since).toBeNull();
    });

    it("calculates minutes out of range", () => {
      trackPosition(defaultPos);
      markOutOfRange("Pos1");
      const mins = minutesOutOfRange("Pos1");
      expect(mins).toBeGreaterThanOrEqual(0);
    });

    it("returns 0 when not out of range", () => {
      trackPosition(defaultPos);
      expect(minutesOutOfRange("Pos1")).toBe(0);
    });

    it("returns 0 for non-existent position", () => {
      expect(minutesOutOfRange("NonExistent")).toBe(0);
    });

    it("does nothing for non-existent position on markOutOfRange", () => {
      markOutOfRange("NonExistent");
      expect(getTrackedPosition("NonExistent")).toBeNull();
    });

    it("does nothing for non-existent position on markInRange", () => {
      markInRange("NonExistent");
      expect(getTrackedPosition("NonExistent")).toBeNull();
    });
  });

  describe("recordClaim", () => {
    it("records fee claim and updates totals", () => {
      trackPosition(defaultPos);
      recordClaim("Pos1", 2.5);
      const pos = getTrackedPosition("Pos1");
      expect(pos!.total_fees_claimed_usd).toBe(2.5);
      expect(pos!.last_claim_at).toBeDefined();
      expect(pos!.notes.length).toBe(1);
      expect(pos!.notes[0]).toContain("Claimed ~$2.50");
    });

    it("accumulates multiple claims", () => {
      trackPosition(defaultPos);
      recordClaim("Pos1", 1.0);
      recordClaim("Pos1", 2.0);
      expect(getTrackedPosition("Pos1")!.total_fees_claimed_usd).toBe(3.0);
      expect(getTrackedPosition("Pos1")!.notes.length).toBe(2);
    });

    it("does nothing for non-existent position", () => {
      recordClaim("NonExistent", 5.0);
      expect(getTrackedPosition("NonExistent")).toBeNull();
    });
  });

  describe("recordClose", () => {
    it("marks position closed with reason", () => {
      trackPosition(defaultPos);
      recordClose("Pos1", "take_profit");
      const pos = getTrackedPosition("Pos1");
      expect(pos!.closed).toBe(true);
      expect(pos!.closed_at).toBeDefined();
      expect(pos!.notes.length).toBe(1);
      expect(pos!.notes[0]).toContain("take_profit");
    });

    it("adds close event to recentEvents", () => {
      trackPosition(defaultPos);
      recordClose("Pos1", "stop_loss");
      const summary = getStateSummary();
      const closeEvent = summary.recent_events.find((e) => e.action === "close");
      expect(closeEvent).toBeDefined();
      expect(closeEvent!.reason).toBe("stop_loss");
    });

    it("does nothing for non-existent position", () => {
      recordClose("NonExistent", "test");
      expect(getTrackedPosition("NonExistent")).toBeNull();
    });
  });

  describe("setPositionInstruction", () => {
    it("sets instruction on position", () => {
      trackPosition(defaultPos);
      const result = setPositionInstruction("Pos1", "hold");
      expect(result).toBe(true);
      expect(getTrackedPosition("Pos1")!.instruction).toBe("hold");
    });

    it("clears instruction when set to null", () => {
      trackPosition(defaultPos);
      setPositionInstruction("Pos1", "hold");
      const cleared = setPositionInstruction("Pos1", null);
      expect(cleared).toBe(true);
    });

    it("returns false for non-existent position", () => {
      expect(setPositionInstruction("NonExistent", "hold")).toBe(false);
    });
  });

  describe("queuePeakConfirmation", () => {
    it("queues a new peak when candidate is higher than current", () => {
      trackPosition(defaultPos);
      const result = queuePeakConfirmation("Pos1", 10);
      expect(result).toBe(true);
      const pos = getTrackedPosition("Pos1");
      expect(pos!.pending_peak_pnl_pct).toBe(10);
      expect(pos!.pending_peak_started_at).toBeDefined();
    });

    it("rejects candidate below or equal to current peak", () => {
      trackPosition(defaultPos);
      expect(queuePeakConfirmation("Pos1", 0)).toBe(false);
      expect(queuePeakConfirmation("Pos1", -5)).toBe(false);
    });

    it("rejects null candidate", () => {
      trackPosition(defaultPos);
      expect(queuePeakConfirmation("Pos1", null)).toBe(false);
    });

    it("does nothing for closed position", () => {
      trackPosition(defaultPos);
      recordClose("Pos1", "test");
      expect(queuePeakConfirmation("Pos1", 10)).toBe(false);
    });

    it("does nothing for non-existent position", () => {
      expect(queuePeakConfirmation("NonExistent", 10)).toBe(false);
    });

    it("updates pending peak if candidate is higher", () => {
      trackPosition(defaultPos);
      queuePeakConfirmation("Pos1", 10);
      const result = queuePeakConfirmation("Pos1", 15);
      expect(result).toBe(true);
      expect(getTrackedPosition("Pos1")!.pending_peak_pnl_pct).toBe(15);
    });

    it("does not update pending peak if candidate is lower", () => {
      trackPosition(defaultPos);
      queuePeakConfirmation("Pos1", 15);
      const result = queuePeakConfirmation("Pos1", 10);
      expect(result).toBe(false);
      expect(getTrackedPosition("Pos1")!.pending_peak_pnl_pct).toBe(15);
    });

    it("immediately confirms peak when immediate option is set", () => {
      trackPosition(defaultPos);
      const result = queuePeakConfirmation("Pos1", 20, { immediate: true });
      expect(result).toBe(true);
      const pos = getTrackedPosition("Pos1");
      expect(pos!.peak_pnl_pct).toBe(20);
      expect(pos!.pending_peak_pnl_pct).toBeNull();
      expect(pos!.pending_peak_started_at).toBeNull();
    });
  });

  describe("resolvePendingPeak", () => {
    it("confirms peak when current PnL meets tolerance", () => {
      trackPosition(defaultPos);
      queuePeakConfirmation("Pos1", 20);
      const result = resolvePendingPeak("Pos1", 18, 0.85);
      expect(result.confirmed).toBe(true);
      expect(result.pending).toBe(false);
      expect(result.peak).toBe(20);
    });

    it("rejects peak when current PnL is below tolerance", () => {
      trackPosition(defaultPos);
      queuePeakConfirmation("Pos1", 20);
      const result = resolvePendingPeak("Pos1", 10, 0.85);
      expect(result.confirmed).toBe(false);
      expect(result.pending).toBe(false);
      expect(getTrackedPosition("Pos1")!.pending_peak_pnl_pct).toBeNull();
    });

    it("returns no pending when there is no pending peak", () => {
      trackPosition(defaultPos);
      const result = resolvePendingPeak("Pos1", 15);
      expect(result.confirmed).toBe(false);
      expect(result.pending).toBe(false);
    });

    it("returns no pending for closed position", () => {
      trackPosition(defaultPos);
      queuePeakConfirmation("Pos1", 20);
      recordClose("Pos1", "test");
      const result = resolvePendingPeak("Pos1", 18);
      expect(result.confirmed).toBe(false);
      expect(result.pending).toBe(false);
    });

    it("returns no pending for non-existent position", () => {
      const result = resolvePendingPeak("NonExistent", 10);
      expect(result.confirmed).toBe(false);
      expect(result.pending).toBe(false);
    });

    it("uses current PnL to update peak if higher than pending", () => {
      trackPosition(defaultPos);
      queuePeakConfirmation("Pos1", 20);
      const result = resolvePendingPeak("Pos1", 25, 0.85);
      expect(result.confirmed).toBe(true);
      expect(result.peak).toBe(25);
    });
  });

  describe("queueTrailingDropConfirmation", () => {
    it("queues trailing drop when drop exceeds threshold", () => {
      trackPosition(defaultPos);
      const result = queueTrailingDropConfirmation("Pos1", 20, 15, 4);
      expect(result).toBe(true);
      const pos = getTrackedPosition("Pos1");
      expect(pos!.pending_trailing_peak_pnl_pct).toBe(20);
      expect(pos!.pending_trailing_current_pnl_pct).toBe(15);
      expect(pos!.pending_trailing_drop_pct).toBe(5);
    });

    it("rejects when drop is below threshold", () => {
      trackPosition(defaultPos);
      expect(queueTrailingDropConfirmation("Pos1", 20, 18, 4)).toBe(false);
    });

    it("rejects null inputs", () => {
      trackPosition(defaultPos);
      expect(queueTrailingDropConfirmation("Pos1", null, 15, 4)).toBe(false);
      expect(queueTrailingDropConfirmation("Pos1", 20, null, 4)).toBe(false);
      expect(queueTrailingDropConfirmation("Pos1", 20, 15, null)).toBe(false);
    });

    it("does nothing for closed position", () => {
      trackPosition(defaultPos);
      recordClose("Pos1", "test");
      expect(queueTrailingDropConfirmation("Pos1", 20, 15, 4)).toBe(false);
    });

    it("does nothing for non-existent position", () => {
      expect(queueTrailingDropConfirmation("NonExistent", 20, 15, 4)).toBe(false);
    });

    it("updates trailing drop if current PnL is lower (worse)", () => {
      trackPosition(defaultPos);
      queueTrailingDropConfirmation("Pos1", 20, 15, 4);
      const result = queueTrailingDropConfirmation("Pos1", 20, 13, 4);
      expect(result).toBe(true);
      expect(getTrackedPosition("Pos1")!.pending_trailing_current_pnl_pct).toBe(13);
    });

    it("does not update trailing drop if current PnL is higher (better)", () => {
      trackPosition(defaultPos);
      queueTrailingDropConfirmation("Pos1", 20, 15, 4);
      const result = queueTrailingDropConfirmation("Pos1", 20, 17, 4);
      expect(result).toBe(false);
    });

    it("updates trailing drop when dropFromPeak is greater than previous (line 267)", () => {
      trackPosition(defaultPos);
      queueTrailingDropConfirmation("Pos1", 20, 15, 4);
      let pos = getTrackedPosition("Pos1")!;
      expect(pos.pending_trailing_drop_pct).toBe(5);
      // Deeper drop (20 -> 12 = 8 > 5), should update
      const result = queueTrailingDropConfirmation("Pos1", 20, 12, 4);
      expect(result).toBe(true);
      pos = getTrackedPosition("Pos1")!;
      expect(pos.pending_trailing_drop_pct).toBe(8);
    });
  });

  describe("resolvePendingTrailingDrop", () => {
    it("confirms trailing drop when recheck still shows drop", () => {
      trackPosition(defaultPos);
      queueTrailingDropConfirmation("Pos1", 20, 15, 4);
      const result = resolvePendingTrailingDrop("Pos1", 14, 4);
      expect(result.confirmed).toBe(true);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("Trailing TP");
    });

    it("rejects when current PnL has recovered above tolerance", () => {
      trackPosition(defaultPos);
      queueTrailingDropConfirmation("Pos1", 20, 15, 4);
      const result = resolvePendingTrailingDrop("Pos1", 19, 4);
      expect(result.confirmed).toBe(false);
    });

    it("rejects when drop from peak no longer meets threshold", () => {
      trackPosition(defaultPos);
      queueTrailingDropConfirmation("Pos1", 20, 15, 4);
      const result = resolvePendingTrailingDrop("Pos1", 18, 4);
      expect(result.confirmed).toBe(false);
    });

    it("returns no pending when there is no pending trailing drop", () => {
      trackPosition(defaultPos);
      const result = resolvePendingTrailingDrop("Pos1", 15, 4);
      expect(result.confirmed).toBe(false);
      expect(result.pending).toBe(false);
    });

    it("returns no pending for closed position", () => {
      trackPosition(defaultPos);
      queueTrailingDropConfirmation("Pos1", 20, 15, 4);
      recordClose("Pos1", "test");
      const result = resolvePendingTrailingDrop("Pos1", 14, 4);
      expect(result.confirmed).toBe(false);
      expect(result.pending).toBe(false);
    });

    it("returns no pending for non-existent position", () => {
      const result = resolvePendingTrailingDrop("NonExistent", 14, 4);
      expect(result.confirmed).toBe(false);
      expect(result.pending).toBe(false);
    });
  });

  describe("getTrackedPosition", () => {
    it("returns null for non-existent position", () => {
      expect(getTrackedPosition("NonExistent")).toBeNull();
    });

    it("returns position after tracking", () => {
      trackPosition(defaultPos);
      const pos = getTrackedPosition("Pos1");
      expect(pos).not.toBeNull();
      expect(pos!.position).toBe("Pos1");
    });
  });

  describe("getStateSummary", () => {
    it("returns empty summary when no positions", () => {
      const summary = getStateSummary();
      expect(summary.open_positions).toBe(0);
      expect(summary.closed_positions).toBe(0);
      expect(summary.total_fees_claimed_usd).toBe(0);
      expect(summary.positions).toEqual([]);
    });

    it("counts open positions correctly", () => {
      trackPosition(defaultPos);
      trackPosition({ ...defaultPos, position: "Pos2", pool: "Pool2" });
      const summary = getStateSummary();
      expect(summary.open_positions).toBe(2);
    });

    it("counts closed positions correctly", () => {
      trackPosition(defaultPos);
      recordClose("Pos1", "test");
      const summary = getStateSummary();
      expect(summary.open_positions).toBe(0);
      expect(summary.closed_positions).toBe(1);
    });

    it("sums total fees claimed", () => {
      trackPosition(defaultPos);
      trackPosition({ ...defaultPos, position: "Pos2", pool: "Pool2" });
      recordClaim("Pos1", 1.5);
      recordClaim("Pos2", 2.5);
      const summary = getStateSummary();
      expect(summary.total_fees_claimed_usd).toBe(4.0);
    });

    it("includes open position details", () => {
      trackPosition(defaultPos);
      const summary = getStateSummary();
      expect(summary.positions.length).toBe(1);
      expect(summary.positions[0].position).toBe("Pos1");
      expect(summary.positions[0].pool).toBe("Pool1");
      expect(summary.positions[0].strategy).toBe("wide");
    });

    it("includes recent events", () => {
      trackPosition(defaultPos);
      const summary = getStateSummary();
      expect(summary.recent_events.length).toBeGreaterThanOrEqual(1);
      expect(summary.recent_events[0].action).toBe("deploy");
    });

    it("caps recent events to last 10", () => {
      for (let i = 0; i < 15; i++) {
        trackPosition({ ...defaultPos, position: `Pos${i}`, pool: `Pool${i}` });
      }
      const summary = getStateSummary();
      expect(summary.recent_events.length).toBeLessThanOrEqual(10);
    });

    it("includes lastUpdated timestamp", () => {
      trackPosition(defaultPos);
      const summary = getStateSummary();
      expect(summary.last_updated).toBeDefined();
    });
  });

  describe("updatePnlAndCheckExits", () => {
    const mgmtConfig = {
      trailingTakeProfit: true,
      trailingTriggerPct: 20,
      trailingDropPct: 5,
      stopLossPct: -10,
      outOfRangeWaitMinutes: 30,
      minFeePerTvl24h: 0.5,
      minAgeBeforeYieldCheck: 60,
    };

    it("returns null for non-existent position", () => {
      const result = updatePnlAndCheckExits("NonExistent", { pnl_pct: 0, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(result).toBeNull();
    });

    it("returns null for closed position", () => {
      trackPosition(defaultPos);
      recordClose("Pos1", "test");
      const result = updatePnlAndCheckExits("Pos1", { pnl_pct: 0, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(result).toBeNull();
    });

    it("triggers stop loss when PnL drops below threshold", () => {
      trackPosition(defaultPos);
      const result = updatePnlAndCheckExits("Pos1", { pnl_pct: -12, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(result).not.toBeNull();
      expect(result!.action).toBe("STOP_LOSS");
    });

    it("does not trigger stop loss when PnL is above threshold", () => {
      trackPosition(defaultPos);
      const result = updatePnlAndCheckExits("Pos1", { pnl_pct: -5, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(result).toBeNull();
    });

    it("does not trigger stop loss when PnL is suspicious", () => {
      trackPosition(defaultPos);
      const result = updatePnlAndCheckExits("Pos1", { pnl_pct: -12, pnl_pct_suspicious: true, in_range: true, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(result).toBeNull();
    });

    it("triggers trailing TP when drop from peak exceeds threshold", () => {
      trackPosition(defaultPos);
      queuePeakConfirmation("Pos1", 25, { immediate: true });
      const pos = getTrackedPosition("Pos1")!;
      pos.trailing_active = true;
      const result = updatePnlAndCheckExits("Pos1", { pnl_pct: 18, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(result).not.toBeNull();
      expect(result!.action).toBe("TRAILING_TP");
      expect(result!.needs_confirmation).toBe(true);
    });

    it("triggers out of range exit when OOR too long", () => {
      vi.useFakeTimers();
      trackPosition(defaultPos);
      markOutOfRange("Pos1");
      vi.advanceTimersByTime(31 * 60000);
      const result = updatePnlAndCheckExits("Pos1", { pnl_pct: 5, pnl_pct_suspicious: false, in_range: false, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(result).not.toBeNull();
      expect(result!.action).toBe("OUT_OF_RANGE");
    });

    it("triggers low yield exit when fee/TVL is too low and age sufficient", () => {
      trackPosition(defaultPos);
      const result = updatePnlAndCheckExits("Pos1", { pnl_pct: 5, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 0.2, age_minutes: 120 }, mgmtConfig);
      expect(result).not.toBeNull();
      expect(result!.action).toBe("LOW_YIELD");
    });

    it("does not trigger low yield when age is below minimum", () => {
      trackPosition(defaultPos);
      const result = updatePnlAndCheckExits("Pos1", { pnl_pct: 5, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 0.2, age_minutes: 30 }, mgmtConfig);
      expect(result).toBeNull();
    });

    it("activates trailing TP when peak reaches trigger threshold", () => {
      trackPosition(defaultPos);
      queuePeakConfirmation("Pos1", 25, { immediate: true });
      expect(getTrackedPosition("Pos1")!.trailing_active).toBe(false);
      updatePnlAndCheckExits("Pos1", { pnl_pct: 25, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(getTrackedPosition("Pos1")!.trailing_active).toBe(true);
    });

    it("marks position out of range when in_range is false", () => {
      trackPosition(defaultPos);
      updatePnlAndCheckExits("Pos1", { pnl_pct: 5, pnl_pct_suspicious: false, in_range: false, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(getTrackedPosition("Pos1")!.out_of_range_since).toBeDefined();
    });

    it("marks position back in range when in_range is true", () => {
      trackPosition(defaultPos);
      markOutOfRange("Pos1");
      updatePnlAndCheckExits("Pos1", { pnl_pct: 5, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(getTrackedPosition("Pos1")!.out_of_range_since).toBeNull();
    });

    it("returns confirmed recheck for trailing TP exit", () => {
      vi.useFakeTimers();
      trackPosition(defaultPos);
      const pos = getTrackedPosition("Pos1")!;
      pos.confirmed_trailing_exit_reason = "Trailing TP: peak 20% -> current 15%";
      pos.confirmed_trailing_exit_until = new Date(Date.now() + 60000).toISOString();
      // Must save state back via setPositionInstruction trick: use a helper
      // Actually we need to write to state.json directly since load/save are not exported
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      state.positions.Pos1.confirmed_trailing_exit_reason = "Trailing TP: peak 20% -> current 15%";
      state.positions.Pos1.confirmed_trailing_exit_until = new Date(Date.now() + 60000).toISOString();
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      const result = updatePnlAndCheckExits("Pos1", { pnl_pct: 15, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(result).not.toBeNull();
      expect(result!.action).toBe("TRAILING_TP");
      expect(result!.confirmed_recheck).toBe(true);
    });

    it("clears expired trailing exit without returning action", () => {
      vi.useFakeTimers();
      trackPosition(defaultPos);
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      state.positions.Pos1.confirmed_trailing_exit_reason = "old exit";
      state.positions.Pos1.confirmed_trailing_exit_until = new Date(Date.now() - 60000).toISOString();
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      const result = updatePnlAndCheckExits("Pos1", { pnl_pct: 5, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(result).toBeNull();
    });

    it("does not trigger trailing TP when trailing_active is false", () => {
      trackPosition(defaultPos);
      queuePeakConfirmation("Pos1", 10, { immediate: true });
      const result = updatePnlAndCheckExits("Pos1", { pnl_pct: 3, pnl_pct_suspicious: false, in_range: true, fee_per_tvl_24h: 1 }, mgmtConfig);
      expect(result).toBeNull();
    });
  });

  describe("syncOpenPositions", () => {
    it("closes positions not in active list after grace period", () => {
      vi.useFakeTimers();
      trackPosition(defaultPos);
      vi.advanceTimersByTime(10 * 60000);
      syncOpenPositions(["OtherPos"]);
      expect(getTrackedPosition("Pos1")!.closed).toBe(true);
      expect(getTrackedPosition("Pos1")!.notes[0]).toContain("Auto-closed");
    });

    it("does not close positions within grace period", () => {
      trackPosition(defaultPos);
      syncOpenPositions(["OtherPos"]);
      expect(getTrackedPosition("Pos1")!.closed).toBe(false);
    });

    it("does not close positions that are in active list", () => {
      vi.useFakeTimers();
      trackPosition(defaultPos);
      vi.advanceTimersByTime(10 * 60000);
      syncOpenPositions(["Pos1"]);
      expect(getTrackedPosition("Pos1")!.closed).toBe(false);
    });

    it("skips already closed positions", () => {
      trackPosition(defaultPos);
      recordClose("Pos1", "test");
      syncOpenPositions([]);
      const pos = getTrackedPosition("Pos1");
      expect(pos!.notes.filter((n) => n.includes("Auto-closed")).length).toBe(0);
    });

    it("does nothing when all positions are active", () => {
      trackPosition(defaultPos);
      trackPosition({ ...defaultPos, position: "Pos2", pool: "Pool2" });
      syncOpenPositions(["Pos1", "Pos2"]);
      expect(getTrackedPosition("Pos1")!.closed).toBe(false);
      expect(getTrackedPosition("Pos2")!.closed).toBe(false);
    });
  });

  describe("briefing date", () => {
    it("returns null initially", () => {
      expect(getLastBriefingDate()).toBeNull();
    });

    it("sets and retrieves briefing date", () => {
      setLastBriefingDate("2026-04-30");
      expect(getLastBriefingDate()).toBe("2026-04-30");
    });

    it("uses current date when no argument provided", () => {
      setLastBriefingDate();
      const today = new Date().toISOString().slice(0, 10);
      expect(getLastBriefingDate()).toBe(today);
    });
  });

  describe("recentEvents trimming", () => {
    it("trims events when exceeding MAX_RECENT_EVENTS (line 50-51)", () => {
      trackPosition(defaultPos);
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      state.recentEvents = Array(25).fill(null).map((_, i) => ({
        timestamp: new Date().toISOString(),
        type: "test",
        message: `Event ${i}`,
      }));
      fs.writeFileSync(STATE_FILE, JSON.stringify(state));
      trackPosition({ ...defaultPos, position: "PosTrim", pool: "PoolTrim" });
      const updated = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      expect(updated.recentEvents.length).toBeLessThanOrEqual(20);
    });
  });

  describe("load() corrupt file fallback (lines 21-24)", () => {
    it("returns default state when state.json is corrupt", () => {
      trackPosition(defaultPos);
      fs.writeFileSync(STATE_FILE, "{ invalid json }}}");
      const pos = getTrackedPosition("Pos1");
      expect(pos).toBeNull();
    });
  });

  describe("queueTrailingDropConfirmation line 267 branch", () => {
    it("updates via dropFromPeak > pending branch when current PnL recovered (line 267)", () => {
      trackPosition(defaultPos);
      queueTrailingDropConfirmation("Pos1", 20, 15, 4);
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      // Set pending_current lower than new current, so 2nd clause is false
      state.positions.Pos1.pending_trailing_drop_pct = 2;
      state.positions.Pos1.pending_trailing_current_pnl_pct = 14;
      fs.writeFileSync(STATE_FILE, JSON.stringify(state));
      // dropFromPeak = 20 - 15 = 5 >= 4 ✓
      // 14 == null → false; 15 < 14 → false; 5 > 2 → true (line 267)
      const result = queueTrailingDropConfirmation("Pos1", 20, 15, 4);
      expect(result).toBe(true);
      const pos = getTrackedPosition("Pos1")!;
      expect(pos.pending_trailing_drop_pct).toBe(5);
    });
  });
});
