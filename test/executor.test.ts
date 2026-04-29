import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { executeTool } from "../src/tools/executor.js";
import { config } from "../src/core/config/config.js";
import * as dlmm from "../src/tools/dlmm.js";
import * as wallet from "../src/tools/wallet.js";

// Mock DLMM and wallet modules for deploy_position safety tests
vi.mock("../src/tools/dlmm.js", () => ({
  deployPosition: vi.fn().mockResolvedValue({ success: true, position: "TestPos", txs: ["tx1"] }),
  getMyPositions: vi.fn(),
  getPositionPnl: vi.fn().mockResolvedValue({ pnl_usd: 0, pnl_pct: 0 }),
  getActiveBin: vi.fn().mockResolvedValue({ binId: 1000 }),
  searchPools: vi.fn().mockResolvedValue({ pools: [] }),
  getWalletPositions: vi.fn().mockResolvedValue({ positions: [] }),
  closePosition: vi.fn().mockResolvedValue({ success: true }),
  claimFees: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../src/tools/wallet.js", () => ({
  getWalletBalances: vi.fn(),
  swapToken: vi.fn().mockResolvedValue({ success: true, amount_out: 0.1 }),
  normalizeMint: (v: string) => v,
}));

vi.mock("../src/services/telegram.js", () => ({
  notifyDeploy: vi.fn().mockResolvedValue(undefined),
  notifyClose: vi.fn().mockResolvedValue(undefined),
  notifySwap: vi.fn().mockResolvedValue(undefined),
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLACKLIST_FILE = path.join(__dirname, "..", "src", "token-blacklist.json");
const DEV_BLOCKLIST_FILE = path.join(__dirname, "..", "src", "dev-blocklist.json");

function clearBlacklistFile() {
  if (fs.existsSync(BLACKLIST_FILE)) fs.writeFileSync(BLACKLIST_FILE, "{}");
}
function clearDevBlocklistFile() {
  if (fs.existsSync(DEV_BLOCKLIST_FILE)) fs.writeFileSync(DEV_BLOCKLIST_FILE, "{}");
}

describe("executor", () => {
  beforeEach(() => {
    clearBlacklistFile();
    clearDevBlocklistFile();
  });

  afterEach(() => {
    clearBlacklistFile();
    clearDevBlocklistFile();
    vi.restoreAllMocks();
  });

  describe("executeTool", () => {
    it("returns error for unknown tool", async () => {
      const result = await executeTool("nonexistent_tool", {});
      expect(result.error).toBe("Unknown tool: nonexistent_tool");
    });

    it("normalizes tool name by stripping content after <", async () => {
      const result = await executeTool("list_blacklist<with_extra>", {});
      expect(result).toHaveProperty("count");
      expect(result).toHaveProperty("blacklist");
    });
  });

  describe("list_blacklist", () => {
    it("returns empty list initially", async () => {
      const result = await executeTool("list_blacklist", {});
      expect(result.count).toBe(0);
      expect(result.blacklist).toEqual([]);
    });

    it("returns added entries", async () => {
      await executeTool("add_to_blacklist", { mint: "TestMint1", reason: "scam" });
      const result = await executeTool("list_blacklist", {}) as { count: number; blacklist: Array<{ mint: string }> };
      expect(result.count).toBeGreaterThan(0);
      expect(result.blacklist.some((i) => i.mint === "TestMint1")).toBe(true);
    });

    it("removes entries", async () => {
      await executeTool("add_to_blacklist", { mint: "TempMint", reason: "temp" });
      await executeTool("remove_from_blacklist", { mint: "TempMint" });
      const result = await executeTool("list_blacklist", {}) as { count: number; blacklist: Array<{ mint: string }> };
      expect(result.blacklist.some((i) => i.mint === "TempMint")).toBe(false);
    });
  });

  describe("list_blocked_deployers", () => {
    it("returns empty list initially", async () => {
      const result = await executeTool("list_blocked_deployers", {});
      expect(result.count).toBe(0);
      expect(result.blocked_devs).toEqual([]);
    });

    it("blocks and lists deployers", async () => {
      await executeTool("block_deployer", { wallet: "Dev123", reason: "farm" });
      const result = await executeTool("list_blocked_deployers", {}) as { count: number; blocked_devs: Array<{ wallet: string }> };
      expect(result.blocked_devs.some((d) => d.wallet === "Dev123")).toBe(true);
    });

    it("unblocks deployers", async () => {
      await executeTool("block_deployer", { wallet: "TempDev", reason: "temp" });
      await executeTool("unblock_deployer", { wallet: "TempDev" });
      const result = await executeTool("list_blocked_deployers", {}) as { count: number; blocked_devs: Array<{ wallet: string }> };
      expect(result.blocked_devs.some((d) => d.wallet === "TempDev")).toBe(false);
    });
  });

  describe("update_config", () => {
    it("rejects invalid changes format", async () => {
      const result = await executeTool("update_config", { changes: "not an object" as any });
      expect(result.success).toBe(false);
      expect(result.error).toContain("changes must be an object");
    });

    it("reports unknown keys", async () => {
      const result = await executeTool("update_config", { changes: { nonexistentKey: 123 } });
      expect(result.success).toBe(false);
      expect(result.unknown).toContain("nonexistentKey");
    });

    it("applies valid screening config changes", async () => {
      const result = await executeTool("update_config", { changes: { minOrganic: 75 }, reason: "test" }) as { success: boolean; applied: Record<string, unknown> };
      expect(result.success).toBe(true);
      expect(result.applied.minOrganic).toBe(75);
    });

    it("coerces boolean values correctly", async () => {
      const result = await executeTool("update_config", { changes: { excludeHighSupplyConcentration: "true" } }) as { success: boolean; applied: Record<string, unknown> };
      expect(result.success).toBe(true);
      expect(result.applied.excludeHighSupplyConcentration).toBe(true);
    });

    it("rejects invalid boolean values", async () => {
      const result = await executeTool("update_config", { changes: { excludeHighSupplyConcentration: "maybe" } });
      expect(result.success).toBe(false);
      expect(result.error).toContain("must be true or false");
    });

    it("applies array values correctly", async () => {
      const result = await executeTool("update_config", { changes: { blockedLaunchpads: ["pump", "raydium"] } }) as { success: boolean; applied: Record<string, unknown> };
      expect(result.success).toBe(true);
      expect(result.applied.blockedLaunchpads).toEqual(["pump", "raydium"]);
    });

    it("applies string values with trimming", async () => {
      const result = await executeTool("update_config", { changes: { timeframe: "  15m  " } }) as { success: boolean; applied: Record<string, unknown> };
      expect(result.success).toBe(true);
      expect(result.applied.timeframe).toBe("15m");
    });

    it("accepts null values for optional fields", async () => {
      const result = await executeTool("update_config", { changes: { minTokenAgeHours: null } }) as { success: boolean; applied: Record<string, unknown> };
      expect(result.success).toBe(true);
      expect(result.applied.minTokenAgeHours).toBeNull();
    });

    it("rejects non-finite numbers", async () => {
      const result = await executeTool("update_config", { changes: { minTvl: NaN } });
      expect(result.success).toBe(false);
      expect(result.error).toContain("must be a finite number");
    });

    it("handles case-insensitive key matching", async () => {
      const result = await executeTool("update_config", { changes: { MINORGANIC: 80 } }) as { success: boolean; applied: Record<string, unknown> };
      expect(result.success).toBe(true);
      expect(result.applied.minOrganic).toBe(80);
    });

    it("records self-tune lesson for config changes", async () => {
      const result = await executeTool("update_config", { changes: { minOrganic: 90 }, reason: "optimization" });
      expect(result.success).toBe(true);
      // Verify lesson was added by checking list_lessons
      const lessons = await executeTool("list_lessons", { tag: "self_tune" }) as { lessons: Array<{ tags?: string[]; rule?: string }> };
      const selfTuneLessons = lessons.lessons.filter((l) =>
        l.tags?.includes("self_tune") && l.rule?.includes("minOrganic=90"),
      );
      expect(selfTuneLessons.length).toBeGreaterThan(0);
    });
  });

  describe("clear_lessons", () => {
    it("rejects invalid mode", async () => {
      const result = await executeTool("clear_lessons", { mode: "invalid" });
      expect(result.error).toBe("invalid mode");
    });

    it("requires keyword for keyword mode", async () => {
      const result = await executeTool("clear_lessons", { mode: "keyword" });
      expect(result.error).toBe("keyword required for mode=keyword");
    });
  });

  describe("self_update", () => {
    it("is disabled by default", async () => {
      // self_update requires ALLOW_SELF_UPDATE=true and TTY, so should be blocked
      const result = await executeTool("self_update", {});
      expect(result.blocked).toBe(true);
      expect(result.reason).toMatch(/disabled|interactive/i);
    });
  });

  describe("deploy_position safety checks", () => {
    beforeEach(() => {
      (dlmm.getMyPositions as any).mockResolvedValue({ total_positions: 0, positions: [] });
      (wallet.getWalletBalances as any).mockResolvedValue({ sol: 5, tokens: [] });
    });

    it("blocks deploy when bin_step is below minBinStep", async () => {
      const result = await executeTool("deploy_position", { pool_address: "Pool1", amount_sol: 0.5, bin_step: 50 });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("outside the allowed range");
    });

    it("blocks deploy when bin_step is above maxBinStep", async () => {
      const result = await executeTool("deploy_position", { pool_address: "Pool1", amount_sol: 0.5, bin_step: 200 });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("outside the allowed range");
    });

    it("blocks deploy when max positions reached", async () => {
      (dlmm.getMyPositions as any).mockResolvedValue({ total_positions: 3, positions: [] });
      const result = await executeTool("deploy_position", { pool_address: "Pool1", amount_sol: 0.5, bin_step: 100 });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Max positions");
    });

    it("blocks deploy when pool already has open position", async () => {
      (dlmm.getMyPositions as any).mockResolvedValue({ total_positions: 1, positions: [{ pool: "ExistingPool" }] });
      const result = await executeTool("deploy_position", { pool_address: "ExistingPool", amount_sol: 0.5, bin_step: 100 });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("duplicate");
    });

    it("blocks deploy when base token already has open position", async () => {
      (dlmm.getMyPositions as any).mockResolvedValue({ total_positions: 1, positions: [{ pool: "OtherPool", base_mint: "TokenX" }] });
      const result = await executeTool("deploy_position", { pool_address: "Pool1", base_mint: "TokenX", amount_sol: 0.5, bin_step: 100 });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("One position per token");
    });

    it("blocks deploy when amount_sol is zero", async () => {
      const result = await executeTool("deploy_position", { pool_address: "Pool1", amount_sol: 0, bin_step: 100 });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("positive SOL amount");
    });

    it("blocks deploy when amount_sol is below minimum", async () => {
      const result = await executeTool("deploy_position", { pool_address: "Pool1", amount_sol: 0.05, bin_step: 100 });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("below the minimum");
    });

    it("blocks deploy when amount_sol exceeds maximum", async () => {
      const result = await executeTool("deploy_position", { pool_address: "Pool1", amount_sol: 100, bin_step: 100 });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("exceeds maximum");
    });

    it("blocks deploy when insufficient SOL balance", async () => {
      (wallet.getWalletBalances as any).mockResolvedValue({ sol: 0.1, tokens: [] });
      const result = await executeTool("deploy_position", { pool_address: "Pool1", amount_sol: 0.5, bin_step: 100 });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Insufficient SOL");
    });

    it("allows deploy when all checks pass", async () => {
      const result = await executeTool("deploy_position", { pool_address: "Pool1", amount_sol: 0.5, bin_step: 100 });
      // Safety checks passed (not blocked by executor)
      expect(result.blocked).toBeUndefined();
    });

    it("skips balance check in DRY_RUN mode", async () => {
      const orig = process.env.DRY_RUN;
      process.env.DRY_RUN = "true";
      (wallet.getWalletBalances as any).mockResolvedValue({ sol: 0.01, tokens: [] });
      const result = await executeTool("deploy_position", { pool_address: "Pool1", amount_sol: 0.5, bin_step: 100 });
      expect(result.blocked).toBeUndefined();
      process.env.DRY_RUN = orig;
    });
  });
});
