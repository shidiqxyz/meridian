import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeDeployAmount, config, reloadScreeningThresholds } from "../src/core/config/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "..", "src", "core", "config", "user-config.json");

describe("computeDeployAmount", () => {
  let savedDeployAmountSol: number;
  let savedMaxDeployAmount: number;
  let savedGasReserve: number;
  let savedPositionSizePct: number;

  beforeEach(() => {
    savedDeployAmountSol = config.management.deployAmountSol;
    savedMaxDeployAmount = config.risk.maxDeployAmount;
    savedGasReserve = config.management.gasReserve;
    savedPositionSizePct = config.management.positionSizePct;

    config.management.deployAmountSol = 0.5;
    config.risk.maxDeployAmount = 50;
    config.management.gasReserve = 0.2;
    config.management.positionSizePct = 0.35;
  });

  afterEach(() => {
    config.management.deployAmountSol = savedDeployAmountSol;
    config.risk.maxDeployAmount = savedMaxDeployAmount;
    config.management.gasReserve = savedGasReserve;
    config.management.positionSizePct = savedPositionSizePct;
  });

  it("returns floor (deployAmountSol) when wallet has just enough above gas reserve", () => {
    // gasReserve=0.2, deployAmountSol=0.5, positionSizePct=0.35
    // deployable = 1 - 0.2 = 0.8, dynamic = 0.8 * 0.35 = 0.28
    // max(0.5, 0.28) = 0.5 (floor)
    expect(computeDeployAmount(1)).toBe(0.5);
  });

  it("scales dynamically as wallet grows", () => {
    // deployable = 10 - 0.2 = 9.8, dynamic = 9.8 * 0.35 = 3.43
    // max(0.5, 3.43) = 3.43
    expect(computeDeployAmount(10)).toBe(3.43);
  });

  it("caps at maxDeployAmount", () => {
    // deployable = 200 - 0.2 = 199.8, dynamic = 199.8 * 0.35 = 69.93
    // min(50, max(0.5, 69.93)) = 50
    expect(computeDeployAmount(200)).toBe(50);
  });

  it("returns floor when wallet has no SOL (clamped to floor)", () => {
    // deployable = 0 - 0.2 = negative, clamped to 0
    // max(0.5, 0) = 0.5 (floor)
    expect(computeDeployAmount(0)).toBe(0.5);
  });

  it("returns floor when wallet is below gas reserve", () => {
    // deployable = 0.1 - 0.2 = negative, clamped to 0
    // max(0.5, 0) = 0.5
    expect(computeDeployAmount(0.1)).toBe(0.5);
  });

  it("returns floor at exact gas reserve boundary", () => {
    // deployable = 0.2 - 0.2 = 0
    // max(0.5, 0) = 0.5
    expect(computeDeployAmount(0.2)).toBe(0.5);
  });

  it("returns floor when dynamic is just below floor", () => {
    // deployable = 1.42857 - 0.2 = 1.22857, dynamic = 0.4299995
    // max(0.5, 0.43) = 0.5
    expect(computeDeployAmount(1.42857)).toBe(0.5);
  });

  it("compounds at wallet size where dynamic exceeds floor", () => {
    // deployable = 2 - 0.2 = 1.8, dynamic = 1.8 * 0.35 = 0.63
    // max(0.5, 0.63) = 0.63
    expect(computeDeployAmount(2)).toBe(0.63);
  });
});

describe("config defaults", () => {
  it("has screening config with required fields", () => {
    expect(config.screening.minTvl).toBeGreaterThan(0);
    expect(config.screening.maxTvl).toBeGreaterThan(config.screening.minTvl);
    expect(config.screening.minBinStep).toBeGreaterThan(0);
    expect(config.screening.maxBinStep).toBeGreaterThan(config.screening.minBinStep);
    expect(config.screening.minOrganic).toBeGreaterThanOrEqual(60);
    expect(config.screening.timeframe).toMatch(/\d+m/);
  });

  it("has management config with required fields", () => {
    expect(config.management.gasReserve).toBeGreaterThan(0);
    expect(config.management.deployAmountSol).toBeGreaterThan(0);
    expect(config.management.positionSizePct).toBeGreaterThan(0);
    expect(config.management.positionSizePct).toBeLessThanOrEqual(1);
    expect(config.management.outOfRangeWaitMinutes).toBeGreaterThan(0);
  });

  it("has risk config with required fields", () => {
    expect(config.risk.maxDeployAmount).toBeGreaterThan(0);
    expect(config.risk.maxDeployAmount).toBeGreaterThan(config.management.deployAmountSol);
    expect(config.risk.maxPositions).toBeGreaterThan(0);
  });

  it("has schedule config with intervals", () => {
    expect(config.schedule.managementIntervalMin).toBeGreaterThan(0);
    expect(config.schedule.screeningIntervalMin).toBeGreaterThan(0);
    expect(config.schedule.healthCheckIntervalMin).toBeGreaterThan(0);
  });

  it("has LLM config with models", () => {
    expect(config.llm.managementModel).toBeDefined();
    expect(typeof config.llm.managementModel).toBe("string");
    expect(config.llm.screeningModel).toBeDefined();
    expect(typeof config.llm.screeningModel).toBe("string");
    expect(config.llm.generalModel).toBeDefined();
    expect(typeof config.llm.generalModel).toBe("string");
    expect(config.llm.temperature).toBeGreaterThan(0);
    expect(config.llm.maxTokens).toBeGreaterThan(0);
  });

  it("has darwin config", () => {
    expect(config.darwin).toBeDefined();
    expect(typeof config.darwin.enabled).toBe("boolean");
  });

  it("has hiveMind config", () => {
    expect(config.hiveMind).toBeDefined();
    expect(config.hiveMind.url).toBeDefined();
    expect(config.hiveMind.agentId).toBeDefined();
  });

  it("has api config", () => {
    expect(config.api).toBeDefined();
    expect(config.api.lpAgentRelayEnabled).toBe(false);
  });

  it("has jupiter config", () => {
    expect(config.jupiter).toBeDefined();
    expect(config.jupiter.referralFeeBps).toBe(50);
  });

  it("has indicators config with defaults", () => {
    expect(config.indicators).toBeDefined();
    expect(config.indicators.enabled).toBe(false);
    expect(config.indicators.intervals).toEqual(["5_MINUTE"]);
    expect(config.indicators.candles).toBe(298);
  });

  it("has common token mints", () => {
    expect(config.tokens.SOL).toBe("So11111111111111111111111111111111111111112");
    expect(config.tokens.USDC).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(config.tokens.USDT).toBe("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
  });
});

describe("reloadScreeningThresholds", () => {
  let snapshot: Record<string, unknown>;

  let fileExistedBefore = false;
  let fileContentBefore: string | null = null;

  function saveSnapshot() {
    fileExistedBefore = fs.existsSync(USER_CONFIG_PATH);
    if (fileExistedBefore) fileContentBefore = fs.readFileSync(USER_CONFIG_PATH, "utf8");

    const s = config.screening;
    snapshot = {
      minFeeActiveTvlRatio: s.minFeeActiveTvlRatio,
      minTvl: s.minTvl,
      maxTvl: s.maxTvl,
      minVolume: s.minVolume,
      minOrganic: s.minOrganic,
      minQuoteOrganic: s.minQuoteOrganic,
      minHolders: s.minHolders,
      minMcap: s.minMcap,
      maxMcap: s.maxMcap,
      minBinStep: s.minBinStep,
      maxBinStep: s.maxBinStep,
      timeframe: s.timeframe,
      category: s.category,
      minTokenFeesSol: s.minTokenFeesSol,
      useDiscordSignals: s.useDiscordSignals,
      discordSignalMode: s.discordSignalMode,
      avoidPvpSymbols: s.avoidPvpSymbols,
      blockPvpSymbols: s.blockPvpSymbols,
      minTokenAgeHours: s.minTokenAgeHours,
      maxTokenAgeHours: s.maxTokenAgeHours,
      athFilterPct: s.athFilterPct,
      maxBundlePct: s.maxBundlePct,
      maxBotHoldersPct: s.maxBotHoldersPct,
      allowedLaunchpads: s.allowedLaunchpads,
      blockedLaunchpads: s.blockedLaunchpads,
      maxVolatility: s.maxVolatility,
    };
  }

  function restoreSnapshot() {
    const s = config.screening;
    for (const [key, value] of Object.entries(snapshot)) {
      (s as unknown as Record<string, unknown>)[key] = value;
    }

    if (fileExistedBefore && fileContentBefore !== null) {
      fs.writeFileSync(USER_CONFIG_PATH, fileContentBefore);
    } else if (!fileExistedBefore && fs.existsSync(USER_CONFIG_PATH)) {
      try { fs.unlinkSync(USER_CONFIG_PATH); } catch { /* ignore */ }
    }
  }

  beforeEach(saveSnapshot);
  afterEach(restoreSnapshot);

  it("does nothing when user-config.json does not exist", () => {
    const original = config.screening.minTvl;
    reloadScreeningThresholds();
    expect(config.screening.minTvl).toBe(original);
  });

  it("updates screening thresholds from user-config.json", () => {
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify({ minTvl: 99999, maxTvl: 888888, minOrganic: 75 }));
    reloadScreeningThresholds();
    expect(config.screening.minTvl).toBe(99999);
    expect(config.screening.maxTvl).toBe(888888);
    expect(config.screening.minOrganic).toBe(75);
  });

  it("updates all screening fields from user-config", () => {
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify({
      minFeeActiveTvlRatio: 0.1,
      useDiscordSignals: true,
      discordSignalMode: "override",
      excludeHighSupplyConcentration: false,
      minOrganic: 70,
      minQuoteOrganic: 65,
      minHolders: 600,
      minMcap: 200000,
      maxMcap: 20000000,
      minTvl: 20000,
      maxTvl: 200000,
      minVolume: 1000,
      minBinStep: 90,
      maxBinStep: 130,
      timeframe: "15m",
      category: "new",
      minTokenAgeHours: 1,
      maxTokenAgeHours: 48,
      athFilterPct: 50,
      maxBundlePct: 25,
      maxBotHoldersPct: 20,
      allowedLaunchpads: ["launchpad1"],
      blockedLaunchpads: ["launchpad2"],
      maxVolatility: 4,
    }));
    reloadScreeningThresholds();
    expect(config.screening.minFeeActiveTvlRatio).toBe(0.1);
    expect(config.screening.useDiscordSignals).toBe(true);
    expect(config.screening.discordSignalMode).toBe("override");
    expect(config.screening.excludeHighSupplyConcentration).toBe(false);
    expect(config.screening.minOrganic).toBe(70);
    expect(config.screening.minQuoteOrganic).toBe(65);
    expect(config.screening.minHolders).toBe(600);
    expect(config.screening.minMcap).toBe(200000);
    expect(config.screening.maxMcap).toBe(20000000);
    expect(config.screening.minTvl).toBe(20000);
    expect(config.screening.maxTvl).toBe(200000);
    expect(config.screening.minVolume).toBe(1000);
    expect(config.screening.minBinStep).toBe(90);
    expect(config.screening.maxBinStep).toBe(130);
    expect(config.screening.timeframe).toBe("15m");
    expect(config.screening.category).toBe("new");
    expect(config.screening.minTokenAgeHours).toBe(1);
    expect(config.screening.maxTokenAgeHours).toBe(48);
    expect(config.screening.athFilterPct).toBe(50);
    expect(config.screening.maxBundlePct).toBe(25);
    expect(config.screening.maxBotHoldersPct).toBe(20);
    expect(config.screening.allowedLaunchpads).toEqual(["launchpad1"]);
    expect(config.screening.blockedLaunchpads).toEqual(["launchpad2"]);
    expect(config.screening.maxVolatility).toBe(4);
  });

  it("ignores invalid JSON in user-config.json", () => {
    fs.writeFileSync(USER_CONFIG_PATH, "{ invalid json }");
    const before = { ...config.screening };
    reloadScreeningThresholds();
    expect(config.screening.minTvl).toBe(before.minTvl);
  });
});
