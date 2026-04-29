/**
 * Cron job management module.
 * Extracted from index.js to reduce monolithic structure.
 */

import cron, { type ScheduledTask } from "node-cron";
import { log } from "../logger/logger.js";
import { config } from "../config/config.js";

interface CronContext {
  runManagementCycle: () => Promise<void | string | null>;
  runScreeningCycle: () => Promise<void | string | null>;
  runBriefing: () => Promise<void>;
  maybeRunMissedBriefing: () => Promise<void>;
  timers?: Record<string, number | null>;
  _managementBusy?: boolean;
  _screeningBusy?: boolean;
}

let _cronTasks: (ScheduledTask | { stop: () => void })[] = [];
let _pnlPollInterval: ReturnType<typeof setInterval> | undefined;

/**
 * Start all cron jobs.
 * @param ctx - Context with required functions and state
 */
export function startCronJobs(ctx: CronContext): void {
  stopCronJobs();

  const {
    runManagementCycle,
    runScreeningCycle,
    runBriefing,
    maybeRunMissedBriefing,
    timers = {},
  } = ctx;

  const mgmtTask = cron.schedule(`*/${Math.max(1, config.schedule.managementIntervalMin)} * * * *`, async () => {
    if (ctx._managementBusy) return;
    timers.managementLastRun = Date.now();
    await runManagementCycle();
  });

  const screenTask = cron.schedule(`*/${Math.max(1, config.schedule.screeningIntervalMin)} * * * *`, async () => {
    await runScreeningCycle();
  });

  const healthTask = cron.schedule(`0 * * * *`, async () => {
    if (ctx._managementBusy) return;
    ctx._managementBusy = true;
    log("cron", "Starting health check");
    try {
      const { agentLoop } = await import("../agent/agent.js");
      await agentLoop(`
HEALTH CHECK

Summarize the current portfolio health, total fees earned, and performance of all open positions. Recommend any high-level adjustments if needed.
      `, config.llm.maxSteps, [], "MANAGER");
    } catch (error) {
      log("cron_error", `Health check failed: ${(error as Error).message}`);
    } finally {
      ctx._managementBusy = false;
    }
  });

  // Morning Briefing at 8:00 AM UTC+7 (1:00 AM UTC)
  const briefingTask = cron.schedule(`0 1 * * *`, async () => {
    await runBriefing();
  }, { timezone: 'UTC' });

  // Every 6h — catch up if briefing was missed
  const briefingWatchdog = cron.schedule(`0 */6 * * *`, async () => {
    await maybeRunMissedBriefing();
  }, { timezone: 'UTC' });

  _cronTasks = [mgmtTask, screenTask, healthTask, briefingTask, briefingWatchdog];
  log("cron", `Cycles started — management every ${config.schedule.managementIntervalMin}m, screening every ${config.schedule.screeningIntervalMin}m`);
}

/**
 * Stop all cron jobs.
 */
export function stopCronJobs(): void {
  for (const task of _cronTasks) {
    if (task && typeof task.stop === 'function') {
      task.stop();
    }
  }
  _cronTasks = [];
}

/**
 * Get the current cron tasks (for adding pnl poll reference).
 */
export function getCronTasks(): (ScheduledTask | { stop: () => void })[] {
  return _cronTasks;
}

/**
 * Set the pnl poll interval reference (for cleanup).
 */
export function setPnlPollRef(ref: { _pnlPollInterval?: ReturnType<typeof setInterval> }): void {
  _pnlPollInterval = ref._pnlPollInterval;
}
