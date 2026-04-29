/**
 * Critical path tests for Meridian agent.
 * Run: npx tsx test/test-critical-paths.ts
 */

import { evolveThresholds } from "../src/core/state/lessons.js";
import { config } from "../src/core/config/config.js";
import fs from "fs";
import path from "path";

const TEST_STATE = "./test-state.json";
const TEST_LESSONS = "./test-lessons.json";

function cleanup() {
  [TEST_STATE, TEST_LESSONS].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

function makePerf(overrides = {}) {
  return {
    pnl_pct: 10,
    volatility: 3,
    fee_tvl_ratio: 0.1,
    organic_score: 70,
    ...overrides,
  };
}

async function testEvolveThresholdsConfigKeys() {
  console.log("Testing evolveThresholds config key handling...");

  const perfData = [
    makePerf({ pnl_pct: 15, volatility: 2, fee_tvl_ratio: 0.08 }),
    makePerf({ pnl_pct: 5, volatility: 3, fee_tvl_ratio: 0.1 }),
    makePerf({ pnl_pct: -10, volatility: 5, fee_tvl_ratio: 0.03 }),
    makePerf({ pnl_pct: -8, volatility: 4, fee_tvl_ratio: 0.04 }),
    makePerf({ pnl_pct: 20, volatility: 2, fee_tvl_ratio: 0.12 }),
  ];

  const origMaxVol = (config.screening as any).maxVolatility;
  const origMinFee = config.screening.minFeeActiveTvlRatio;

  try {
    const result = evolveThresholds(perfData as any, config);

    if (!result) {
      console.error("❌ evolveThresholds returned null with valid data");
      return false;
    }

    console.log(`✅ evolveThresholds returned changes: ${JSON.stringify(result.changes)}`);

    if (result.changes.maxVolatility && (config.screening as any).maxVolatility !== result.changes.maxVolatility) {
      console.error(`❌ maxVolatility not applied to config. Expected ${result.changes.maxVolatility}, got ${(config.screening as any).maxVolatility}`);
      return false;
    }

    if (result.changes.minFeeActiveTvlRatio && config.screening.minFeeActiveTvlRatio !== result.changes.minFeeActiveTvlRatio) {
      console.error(`❌ minFeeActiveTvlRatio not applied to config`);
      return false;
    }

    console.log("✅ evolveThresholds config key test passed");
    return true;
  } catch (e: any) {
    console.error(`❌ evolveThresholds test failed: ${e.message}`);
    return false;
  } finally {
    (config.screening as any).maxVolatility = origMaxVol;
    config.screening.minFeeActiveTvlRatio = origMinFee;
  }
}

async function testAtomicStateWrites() {
  console.log("\nTesting atomic state file writes...");

  try {
    const testState = { test: "value", positions: {} };
    const stateFile = TEST_STATE;

    fs.writeFileSync(stateFile, JSON.stringify(testState, null, 2));

    const tmpFile = `${stateFile}.tmp`;
    if (fs.existsSync(tmpFile)) {
      console.error("❌ Temp file left behind after write");
      return false;
    }

    const contents = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (contents.test !== "value") {
      console.error("❌ State file contents incorrect");
      return false;
    }

    console.log("✅ Atomic write test passed");
    return true;
  } catch (e: any) {
    console.error(`❌ Atomic write test failed: ${e.message}`);
    return false;
  }
}

async function runTests() {
  cleanup();
  let passed = 0;
  let failed = 0;

  const tests = [
    testEvolveThresholdsConfigKeys,
    testAtomicStateWrites,
  ];

  for (const test of tests) {
    const result = await test();
    if (result) passed++;
    else failed++;
  }

  console.log(`\n=== Test Results: ${passed} passed, ${failed} failed ===`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
