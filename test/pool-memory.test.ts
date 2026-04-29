import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import {
  recordPoolDeploy,
  recallForPool,
  addPoolNote,
} from "../src/core/state/pool-memory.js";
import { config } from "../src/core/config/config.js";

const POOL_MEMORY_FILE = "./pool-memory.json";

function cleanFiles() {
  for (let i = 0; i < 3; i++) {
    try {
      if (fs.existsSync(POOL_MEMORY_FILE)) fs.unlinkSync(POOL_MEMORY_FILE);
      if (fs.existsSync(`${POOL_MEMORY_FILE}.tmp`)) fs.unlinkSync(`${POOL_MEMORY_FILE}.tmp`);
      break;
    } catch { /* retry */ }
  }
}

describe("pool-memory.ts", () => {
  beforeEach(cleanFiles);
  afterEach(cleanFiles);

  describe("recallForPool", () => {
    it("returns null for unknown pool", () => {
      expect(recallForPool("unknown")).toBeNull();
    });

    it("returns deploy history summary", () => {
      recordPoolDeploy("pool1", {
        pool_name: "TestPool",
        base_mint: "mint1",
        deployed_at: new Date().toISOString(),
        pnl_pct: 10,
        pnl_usd: 5,
        range_efficiency: 80,
        minutes_held: 120,
        fees_earned_usd: 2,
        fees_earned_sol: 0.01,
        fee_earned_pct: 2,
        close_reason: "agent decision",
        strategy: "bid_ask",
        volatility: 3,
      });
      const result = recallForPool("pool1");
      expect(result).toContain("POOL MEMORY");
      expect(result).toContain("1 past deploy");
    });

    it("includes cooldown with reason text (line 360)", () => {
      const entry = {
        pool_name: "TestPool",
        base_mint: "mint1",
        deployed_at: new Date(Date.now() + 3600000).toISOString(),
        pnl_pct: -5,
        pnl_usd: -2,
        range_efficiency: 40,
        minutes_held: 60,
        fees_earned_usd: 0,
        fees_earned_sol: 0,
        fee_earned_pct: 0,
        close_reason: "oor",
        strategy: "bid_ask",
        volatility: 3,
      };
      recordPoolDeploy("pool1", entry);
      const data = JSON.parse(fs.readFileSync(POOL_MEMORY_FILE, "utf8"));
      data.pool1.cooldown_until = new Date(Date.now() + 3600000).toISOString();
      data.pool1.cooldown_reason = "repeated oor";
      fs.writeFileSync(POOL_MEMORY_FILE, JSON.stringify(data));

      const result = recallForPool("pool1");
      expect(result).toContain("POOL COOLDOWN");
      expect(result).toContain("repeated oor");
    });

    it("includes token cooldown with reason (lines 363-364)", () => {
      recordPoolDeploy("pool1", {
        pool_name: "TestPool",
        base_mint: "mint1",
        deployed_at: new Date().toISOString(),
        pnl_pct: 10,
        pnl_usd: 5,
        range_efficiency: 80,
        minutes_held: 120,
        fees_earned_usd: 2,
        fees_earned_sol: 0.01,
        fee_earned_pct: 2,
        close_reason: "agent decision",
        strategy: "bid_ask",
        volatility: 3,
      });
      const data = JSON.parse(fs.readFileSync(POOL_MEMORY_FILE, "utf8"));
      data.pool1.base_mint_cooldown_until = new Date(Date.now() + 3600000).toISOString();
      data.pool1.base_mint_cooldown_reason = "pumped far above range";
      fs.writeFileSync(POOL_MEMORY_FILE, JSON.stringify(data));

      const result = recallForPool("pool1");
      expect(result).toContain("TOKEN COOLDOWN");
      expect(result).toContain("pumped far above range");
    });

    it("includes recent trend with null pnlTrend (line 373)", () => {
      recordPoolDeploy("pool1", {
        pool_name: "TestPool",
        base_mint: "mint1",
        deployed_at: new Date().toISOString(),
        pnl_pct: null as unknown as number,
        pnl_usd: 0,
        range_efficiency: 80,
        minutes_held: 120,
        fees_earned_usd: 2,
        fees_earned_sol: 0.01,
        fee_earned_pct: 2,
        close_reason: "agent decision",
        strategy: "bid_ask",
        volatility: 3,
      });
      const data = JSON.parse(fs.readFileSync(POOL_MEMORY_FILE, "utf8"));
      data.pool1.snapshots = [
        { timestamp: new Date().toISOString(), in_range: true, pnl_pct: null, fee_tvl_ratio: 1.5 },
        { timestamp: new Date().toISOString(), in_range: true, pnl_pct: 5, fee_tvl_ratio: 1.6 },
      ];
      fs.writeFileSync(POOL_MEMORY_FILE, JSON.stringify(data));

      const result = recallForPool("pool1");
      expect(result).toContain("RECENT TREND");
      expect(result).toContain("unknown");
    });

    it("includes note when present", () => {
      recordPoolDeploy("pool1", {
        pool_name: "TestPool",
        base_mint: "mint1",
        deployed_at: new Date().toISOString(),
        pnl_pct: 10,
        pnl_usd: 5,
        range_efficiency: 80,
        minutes_held: 120,
        fees_earned_usd: 2,
        fees_earned_sol: 0.01,
        fee_earned_pct: 2,
        close_reason: "agent decision",
        strategy: "bid_ask",
        volatility: 3,
      });
      addPoolNote({ pool_address: "pool1", note: "Watch this pool closely" });
      const result = recallForPool("pool1");
      expect(result).toContain("NOTE");
      expect(result).toContain("Watch this pool closely");
    });
  });

  describe("recordPoolDeploy cooldowns", () => {
    function oorDeploy(n: number) {
      return {
        pool_name: "OorPool",
        base_mint: "oorMint",
        deployed_at: new Date().toISOString(),
        pnl_pct: -5,
        pnl_usd: -2,
        range_efficiency: 30,
        minutes_held: 60,
        fees_earned_usd: 0,
        fees_earned_sol: 0,
        fee_earned_pct: 0,
        close_reason: "oor",
        strategy: "bid_ask",
        volatility: 3,
      };
    }

    it("sets cooldown after repeated OOR closes (lines 180-189)", () => {
      const triggerCount = config.management.oorCooldownTriggerCount ?? 3;
      for (let i = 0; i < triggerCount; i++) {
        recordPoolDeploy("poolOor", oorDeploy(i));
      }
      const mem = JSON.parse(fs.readFileSync(POOL_MEMORY_FILE, "utf8"));
      expect(mem.poolOor.cooldown_until).toBeDefined();
      expect(mem.poolOor.cooldown_reason).toContain("repeated OOR");
    });

    it("sets cooldown for repeat fee-generating deploys (lines 203-214)", () => {
      const origEnabled = config.management.repeatDeployCooldownEnabled;
      const origHours = config.management.repeatDeployCooldownHours;
      const origTriggerCount = config.management.repeatDeployCooldownTriggerCount;
      const origScope = config.management.repeatDeployCooldownScope;
      const origMinFee = config.management.repeatDeployCooldownMinFeeEarnedPct;
      try {
        config.management.repeatDeployCooldownEnabled = true;
        config.management.repeatDeployCooldownHours = 6;
        config.management.repeatDeployCooldownTriggerCount = 2;
        config.management.repeatDeployCooldownScope = "pool";
        config.management.repeatDeployCooldownMinFeeEarnedPct = 0;

        for (let i = 0; i < 2; i++) {
          recordPoolDeploy("poolFee", {
            pool_name: "FeePool",
            base_mint: "feeMint",
            deployed_at: new Date().toISOString(),
            pnl_pct: 2,
            pnl_usd: 1,
            range_efficiency: 80,
            minutes_held: 120,
            fees_earned_usd: 0.5,
            fees_earned_sol: 0.002,
            fee_earned_pct: 1,
            close_reason: "agent decision",
            strategy: "bid_ask",
            volatility: 3,
          });
        }
        const mem = JSON.parse(fs.readFileSync(POOL_MEMORY_FILE, "utf8"));
        expect(mem.poolFee.cooldown_until).toBeDefined();
        expect(mem.poolFee.cooldown_reason).toContain("repeat fee-generating");
      } finally {
        config.management.repeatDeployCooldownEnabled = origEnabled;
        config.management.repeatDeployCooldownHours = origHours;
        config.management.repeatDeployCooldownTriggerCount = origTriggerCount;
        config.management.repeatDeployCooldownScope = origScope;
        config.management.repeatDeployCooldownMinFeeEarnedPct = origMinFee;
      }
    });

    it("sets base_mint cooldown when scope is 'both' (lines 209-213)", () => {
      const origEnabled = config.management.repeatDeployCooldownEnabled;
      const origHours = config.management.repeatDeployCooldownHours;
      const origTriggerCount = config.management.repeatDeployCooldownTriggerCount;
      const origScope = config.management.repeatDeployCooldownScope;
      const origMinFee = config.management.repeatDeployCooldownMinFeeEarnedPct;
      try {
        config.management.repeatDeployCooldownEnabled = true;
        config.management.repeatDeployCooldownHours = 6;
        config.management.repeatDeployCooldownTriggerCount = 2;
        config.management.repeatDeployCooldownScope = "both";
        config.management.repeatDeployCooldownMinFeeEarnedPct = 0;

        for (let i = 0; i < 2; i++) {
          recordPoolDeploy("poolBoth", {
            pool_name: "BothPool",
            base_mint: "bothMint12345678",
            deployed_at: new Date().toISOString(),
            pnl_pct: 2,
            pnl_usd: 1,
            range_efficiency: 80,
            minutes_held: 120,
            fees_earned_usd: 0.5,
            fees_earned_sol: 0.002,
            fee_earned_pct: 1,
            close_reason: "agent decision",
            strategy: "bid_ask",
            volatility: 3,
          });
        }
        const mem = JSON.parse(fs.readFileSync(POOL_MEMORY_FILE, "utf8"));
        expect(mem.poolBoth.base_mint_cooldown_until).toBeDefined();
        expect(mem.poolBoth.base_mint_cooldown_reason).toContain("repeat fee-generating");
      } finally {
        config.management.repeatDeployCooldownEnabled = origEnabled;
        config.management.repeatDeployCooldownHours = origHours;
        config.management.repeatDeployCooldownTriggerCount = origTriggerCount;
        config.management.repeatDeployCooldownScope = origScope;
        config.management.repeatDeployCooldownMinFeeEarnedPct = origMinFee;
      }
    });
  });
});
