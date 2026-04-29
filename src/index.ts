import "./core/config/envcrypt.js";
import readline from "readline";
import { log } from "./core/logger/logger.js";
import { startCronJobs as startCronModule, stopCronJobs as stopCronModule } from "./core/cron/cron.js";
import { config } from "./core/config/config.js";
import { getMyPositions } from "./tools/dlmm.js";
import { registerCronRestarter } from "./tools/executor.js";
import { stopPolling, sendMessage, sendHTML, isEnabled as telegramEnabled, createLiveMessage } from "./services/telegram.js";
import { generateBriefing } from "./services/briefing.js";
import { getLastBriefingDate, setLastBriefingDate } from "./core/state/state.js";
import {
  bootstrapHiveMind,
  ensureAgentId,
  startHiveMindBackgroundSync,
} from "./services/hivemind.js";

const timers = {
  managementLastRun: null as number | null,
  screeningLastRun: null as number | null,
};

let managementBusy = false;
let screeningBusy = false;

function stripThink(text: string | null): string | null {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function runBriefing(): Promise<void> {
  log("cron", "Starting morning briefing");
  try {
    const briefing = await generateBriefing();
    if (telegramEnabled()) {
      await sendHTML(briefing);
    }
    setLastBriefingDate();
  } catch (error: unknown) {
    log("cron_error", `Morning briefing failed: ${(error as Error).message}`);
  }
}

async function maybeRunMissedBriefing(): Promise<void> {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const lastSent = getLastBriefingDate();
  if (lastSent === todayUtc) return;

  const nowUtc = new Date();
  if (nowUtc.getUTCHours() < 1) return;

  log("cron", `Missed briefing detected (last sent: ${lastSent || "never"})`);
  await runBriefing();
}

export async function runManagementCycle({ silent = false }: { silent?: boolean } = {}): Promise<string | null> {
  if (managementBusy) return null;
  managementBusy = true;
  timers.managementLastRun = Date.now();

  let report = "Management cycle complete.";
  const liveMessage = !silent && telegramEnabled()
    ? await createLiveMessage("Management Cycle", "Evaluating positions...")
    : null;

  try {
    const livePositions = await getMyPositions({ force: true }).catch(() => null);
    const positions = livePositions?.positions || [];
    if (positions.length === 0) {
      report = "No open positions. Triggering screening cycle.";
      void runScreeningCycle().catch((error: Error) => log("cron_error", `Triggered screening failed: ${error.message}`));
    }
    return report;
  } catch (error: unknown) {
    report = `Management cycle failed: ${(error as Error).message}`;
    log("cron_error", report);
    return report;
  } finally {
    managementBusy = false;
    const finalText = stripThink(report) ?? report;
    if (liveMessage) {
      await liveMessage.finalize(finalText).catch((error: unknown) => {
        log("telegram_error", `Telegram error: ${(error as Error).message}`);
      });
    } else if (!silent && telegramEnabled()) {
      await sendMessage(`Management Cycle\n\n${finalText}`).catch((error: unknown) => {
        log("telegram_error", `Telegram error: ${(error as Error).message}`);
      });
    }
  }
}

export async function runScreeningCycle({ silent = false }: { silent?: boolean } = {}): Promise<string | null> {
  if (screeningBusy) return null;
  screeningBusy = true;
  timers.screeningLastRun = Date.now();

  try {
    return "Screening cycle complete.";
  } catch (error: unknown) {
    const report = `Screening cycle failed: ${(error as Error).message}`;
    log("cron_error", report);
    return report;
  } finally {
    screeningBusy = false;
    void silent;
  }
}

export function startCronJobs(): void {
  stopCronJobs();
  startCronModule({
    runManagementCycle: async () => {
      await runManagementCycle();
    },
    runScreeningCycle: async () => {
      await runScreeningCycle();
    },
    runBriefing,
    maybeRunMissedBriefing,
    _managementBusy: managementBusy,
    _screeningBusy: screeningBusy,
    timers,
  });
}

function stopCronJobs(): void {
  stopCronModule();
}

function buildPrompt(): string {
  const formatCountdown = (seconds: number): string => {
    if (seconds <= 0) return "now";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const nextRunIn = (lastRun: number | null, intervalMin: number): number => {
    if (!lastRun) return intervalMin * 60;
    const elapsed = (Date.now() - lastRun) / 1000;
    return Math.max(0, intervalMin * 60 - elapsed);
  };

  const mgmt = formatCountdown(nextRunIn(timers.managementLastRun, config.schedule.managementIntervalMin));
  const scrn = formatCountdown(nextRunIn(timers.screeningLastRun, config.schedule.screeningIntervalMin));
  return `[manage: ${mgmt} | screen: ${scrn}]\n> `;
}

function startREPL(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(),
  });

  rl.prompt();
  rl.on("line", () => {
    rl.setPrompt(buildPrompt());
    rl.prompt();
  });
  rl.on("close", () => {
    log("shutdown", "REPL closed");
    process.exit(0);
  });
}

async function shutdown(signal: string): Promise<void> {
  log("shutdown", `Received ${signal}. Shutting down...`);
  stopPolling();
  const positions = await getMyPositions().catch(() => ({ total_positions: 0 }));
  log("shutdown", `Open positions at shutdown: ${positions.total_positions}`);
  process.exit(0);
}

log("startup", "DLMM LP Agent starting...");
log("startup", `Mode: ${process.env.DRY_RUN === "true" ? "DRY RUN" : "LIVE"}`);
log("startup", `Model: ${process.env.LLM_MODEL || "hermes-3-405b"}`);
ensureAgentId();
bootstrapHiveMind().catch((error: Error) => log("hivemind_warn", `Bootstrap failed: ${error.message}`));
startHiveMindBackgroundSync();
registerCronRestarter(startCronJobs);

if (process.stdin.isTTY) {
  startREPL();
}

startCronJobs();

if (!process.stdin.isTTY) {
  void getMyPositions().then((result) => {
    if (result.total_positions === 0) {
      log("startup", "No open positions - running initial screening cycle");
      void runScreeningCycle().catch((error: Error) => log("cron_error", `Initial screening failed: ${error.message}`));
    }
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
