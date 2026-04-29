import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  addStrategy,
  listStrategies,
  getStrategy,
  setActiveStrategy,
  removeStrategy,
  getActiveStrategy,
} from "../src/core/state/strategy-library.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRATEGY_FILE = path.join(__dirname, "..", "src", "strategy-library.json");

function writeDefaults() {
  const defaults = {
    active: "custom_ratio_spot",
    strategies: {
      custom_ratio_spot: { id: "custom_ratio_spot", name: "Custom Ratio Spot", author: "meridian", lp_strategy: "spot", token_criteria: {}, entry: { condition: "Directional view on token" }, range: { type: "custom" }, exit: { take_profit_pct: 10 }, best_for: "Expressing directional bias", added_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      single_sided_reseed: { id: "single_sided_reseed", name: "Single-Sided Bid-Ask + Re-seed", author: "meridian", lp_strategy: "bid_ask", token_criteria: {}, entry: { condition: "Deploy token-only", single_side: "token" }, range: { type: "default", bins_below_pct: 100 }, exit: {}, best_for: "Riding volatile tokens down", added_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      fee_compounding: { id: "fee_compounding", name: "Fee Compounding", author: "meridian", lp_strategy: "any", token_criteria: {}, entry: { condition: "Deploy normally" }, range: { type: "default" }, exit: { notes: "When unclaimed fees > $5" }, best_for: "Maximizing yield", added_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      multi_layer: { id: "multi_layer", name: "Multi-Layer", author: "meridian", lp_strategy: "mixed", token_criteria: {}, entry: { condition: "Create ONE position", example_patterns: { smooth_edge: "Deploy Bid-Ask then Spot" } }, range: { type: "custom" }, exit: {}, best_for: "Custom liquidity distributions", added_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      partial_harvest: { id: "partial_harvest", name: "Partial Harvest", author: "meridian", lp_strategy: "any", token_criteria: {}, entry: { condition: "Deploy normally" }, range: { type: "default" }, exit: { notes: "withdraw_liquidity(bps=5000) to take 50% off" }, best_for: "Locking in profits", added_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    },
  };
  fs.writeFileSync(STRATEGY_FILE, JSON.stringify(defaults, null, 2));
}

describe("strategy-library.ts", () => {
  beforeEach(writeDefaults);
  afterEach(() => {
    for (let i = 0; i < 5; i++) {
      try {
        if (fs.existsSync(STRATEGY_FILE)) fs.unlinkSync(STRATEGY_FILE);
        break;
      } catch { /* retry */ }
    }
  });

  describe("addStrategy", () => {
    it("adds a custom strategy", () => {
      const result = addStrategy({ id: "my_strategy", name: "My Strategy", author: "test_user", lp_strategy: "spot", best_for: "High volume tokens" });
      expect(result.saved).toBe(true);
      expect(result.id).toBe("my_strategy");
      expect(result.name).toBe("My Strategy");
    });

    it("slugifies the id", () => {
      const result = addStrategy({ id: "My Strategy With Spaces!", name: "Test" });
      expect(result.id).toBe("my_strategy_with_spaces");
    });

    it("returns error when id or name missing", () => {
      expect(addStrategy({ id: "", name: "Test" }).error).toBe("id and name are required");
      expect(addStrategy({ id: "x", name: "" }).error).toBe("id and name are required");
    });

    it("uses defaults for optional fields", () => {
      addStrategy({ id: "minimal", name: "Minimal" });
      const strategy = getStrategy({ id: "minimal" });
      expect(strategy.author).toBe("unknown");
      expect(strategy.lp_strategy).toBe("bid_ask");
      expect(strategy.best_for).toBe("");
    });

    it("auto-sets active when first strategy in empty db", () => {
      fs.writeFileSync(STRATEGY_FILE, JSON.stringify({ active: null, strategies: {} }));
      const result = addStrategy({ id: "first", name: "First Strategy" });
      expect(result.active).toBe(true);
    });

    it("does not overwrite active when adding additional strategy", () => {
      addStrategy({ id: "second", name: "Second" });
      expect(addStrategy({ id: "third", name: "Third" }).active).toBe(false);
    });

    it("overwrites existing strategy with same id", () => {
      addStrategy({ id: "overwrite", name: "Original" });
      addStrategy({ id: "overwrite", name: "Updated" });
      expect(getStrategy({ id: "overwrite" }).name).toBe("Updated");
    });
  });

  describe("listStrategies", () => {
    it("returns all strategies including defaults", () => {
      const list = listStrategies();
      expect(list.count).toBe(5);
      expect(list.active).toBe("custom_ratio_spot");
    });

    it("includes custom strategies", () => {
      addStrategy({ id: "custom", name: "Custom Strat" });
      const list = listStrategies();
      expect(list.count).toBe(6);
      expect(list.strategies.find((s) => s.id === "custom")!.name).toBe("Custom Strat");
    });

    it("marks active strategy correctly", () => {
      setActiveStrategy({ id: "single_sided_reseed" });
      const list = listStrategies();
      expect(list.strategies.find((s) => s.id === "single_sided_reseed")!.active).toBe(true);
    });

    it("truncates added_at to date only", () => {
      expect(listStrategies().strategies[0].added_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("returns empty count after clearing", () => {
      fs.writeFileSync(STRATEGY_FILE, JSON.stringify({ active: null, strategies: {} }));
      const list = listStrategies();
      expect(list.count).toBe(0);
    });
  });

  describe("getStrategy", () => {
    it("returns strategy details", () => {
      const strategy = getStrategy({ id: "fee_compounding" });
      expect(strategy.id).toBe("fee_compounding");
      expect(strategy.name).toBe("Fee Compounding");
      expect(strategy.author).toBe("meridian");
    });

    it("returns error when id not provided", () => {
      expect(getStrategy({ id: "" }).error).toBe("id required");
    });

    it("returns error and available list when not found", () => {
      const result = getStrategy({ id: "nonexistent" });
      expect(result.error).toContain("not found");
      expect(result.available).toContain("custom_ratio_spot");
    });

    it("returns active flag when set", () => {
      setActiveStrategy({ id: "multi_layer" });
      expect(getStrategy({ id: "multi_layer" }).is_active).toBe(true);
    });

    it("includes full strategy fields", () => {
      const strategy = getStrategy({ id: "single_sided_reseed" });
      expect(strategy.entry).toBeDefined();
      expect(strategy.range).toBeDefined();
      expect(strategy.best_for).toBeDefined();
    });
  });

  describe("setActiveStrategy", () => {
    it("sets a default strategy as active", () => {
      const result = setActiveStrategy({ id: "partial_harvest" });
      expect(result.active).toBe("partial_harvest");
      expect(result.name).toBe("Partial Harvest");
    });

    it("sets a custom strategy as active", () => {
      addStrategy({ id: "my_custom", name: "My Custom" });
      expect(setActiveStrategy({ id: "my_custom" }).active).toBe("my_custom");
    });

    it("returns error when id not provided", () => {
      expect(setActiveStrategy({ id: "" }).error).toBe("id required");
    });

    it("returns error when strategy not found", () => {
      const result = setActiveStrategy({ id: "nonexistent" });
      expect(result.error).toContain("not found");
      expect(result.available).toBeDefined();
    });

    it("persists active strategy to file", () => {
      setActiveStrategy({ id: "fee_compounding" });
      expect(JSON.parse(fs.readFileSync(STRATEGY_FILE, "utf8")).active).toBe("fee_compounding");
    });
  });

  describe("removeStrategy", () => {
    it("removes a custom strategy", () => {
      addStrategy({ id: "to_remove", name: "Remove Me" });
      const result = removeStrategy({ id: "to_remove" });
      expect(result.removed).toBe(true);
      expect(getStrategy({ id: "to_remove" }).error).toBeDefined();
    });

    it("auto-assigns new active when removing active strategy", () => {
      setActiveStrategy({ id: "custom_ratio_spot" });
      const result = removeStrategy({ id: "custom_ratio_spot" });
      expect(result.new_active).toBeDefined();
      expect(result.new_active).not.toBe("custom_ratio_spot");
    });

    it("sets active to null when last strategy removed", () => {
      fs.writeFileSync(STRATEGY_FILE, JSON.stringify({ active: "only", strategies: { only: { id: "only", name: "Only", author: "x", lp_strategy: "any", token_criteria: {}, entry: {}, range: {}, exit: {}, best_for: "" } } }));
      expect(removeStrategy({ id: "only" }).new_active).toBeNull();
    });

    it("returns error when id not provided", () => {
      expect(removeStrategy({ id: "" }).error).toBe("id required");
    });

    it("returns error when strategy not found", () => {
      expect(removeStrategy({ id: "nonexistent" }).error).toContain("not found");
    });
  });

  describe("getActiveStrategy", () => {
    it("returns the default active strategy", () => {
      const strategy = getActiveStrategy();
      expect(strategy).not.toBeNull();
      expect(strategy!.id).toBe("custom_ratio_spot");
    });

    it("returns null when active is null", () => {
      fs.writeFileSync(STRATEGY_FILE, JSON.stringify({ active: null, strategies: {} }));
      expect(getActiveStrategy()).toBeNull();
    });

    it("returns null when active strategy was deleted", () => {
      fs.writeFileSync(STRATEGY_FILE, JSON.stringify({ active: "ghost", strategies: {} }));
      expect(getActiveStrategy()).toBeNull();
    });

    it("returns updated active after switch", () => {
      setActiveStrategy({ id: "multi_layer" });
      expect(getActiveStrategy()!.id).toBe("multi_layer");
    });

    it("returns empty when file has corrupt JSON (defaults already loaded at import)", () => {
      fs.writeFileSync(STRATEGY_FILE, "{ invalid json }");
      const list = listStrategies();
      expect(list.count).toBe(0);
      expect(list.active).toBeNull();
    });
  });
});
