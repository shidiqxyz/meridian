import "./core/config/envcrypt.js";
import readline from "readline";
import { execSync, spawn } from "child_process";
import { log } from "./core/logger/logger.js";
import { startCronJobs as startCronModule, stopCronJobs as stopCronModule } from "./core/cron/cron.js";
import { config } from "./core/config/config.js";
import { getMyPositions } from "./tools/dlmm.js";
import { registerCronRestarter } from "./tools/executor.js";
import { agentLoop } from "./core/agent/agent.js";
import { stopPolling, startPolling, sendMessage, sendHTML, isEnabled as telegramEnabled, createLiveMessage } from "./services/telegram.js";
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

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ""));
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

const replSession: Array<{ role: string; content: string }> = [];
const replBusy = { value: false };

function startREPL(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(),
  });

  rl.prompt();
  rl.on("line", async (line: string) => {
    const input = line.trim();
    rl.setPrompt(buildPrompt());
    if (!input) {
      rl.prompt();
      return;
    }
    if (replBusy.value) {
      log("repl", "Agent busy, skipping input");
      rl.prompt();
      return;
    }
    replBusy.value = true;
    try {
      log("repl", `User: ${input}`);
      if (input === "/help" || input === "help") {
        const helpText = "Available commands:\n"
          + "  /positions          List open positions\n"
          + "  /close <n>          Close position by index\n"
          + "  /set <n> <note>     Set note on position\n"
          + "  /help               Show this help\n\n"
          + "Natural language examples:\n"
          + "  Find the best pools to deploy\n"
          + "  Close position 1\n"
          + "  What is my wallet balance?\n"
          + "  Show performance report\n"
          + "  Swap all tokens to SOL";
        console.log(helpText);
        log("repl", `Agent: ${helpText}`);
      } else {
        const result = await agentLoop(input, undefined, replSession, "GENERAL");
        const response = stripMarkdown(stripThink(result.content) ?? "");
        replSession.push({ role: "user", content: input });
        replSession.push({ role: "assistant", content: response ?? "" });
        console.log(response);
        log("repl", `Agent: ${response}`);
      }
    } catch (error: unknown) {
      log("repl_error", `Agent loop failed: ${(error as Error).message}`);
    } finally {
      replBusy.value = false;
      rl.prompt();
    }
  });
  rl.on("close", () => {
    log("shutdown", "REPL closed");
    process.exit(0);
  });
}

async function handleTelegramMessage(msg: { text: string; isCallback?: boolean; callbackQueryId?: string; callbackData?: string; messageId?: number }): Promise<void> {
  if (msg.isCallback) return;
  const text = msg.text.trim();
  if (!text) return;

  if (text === "/positions") {
    const positions = await getMyPositions().catch(() => null);
    const count = positions?.total_positions ?? 0;
    const details = positions?.positions ?? [];
    let reply = `Open positions: ${count}\n\n`;
    for (let i = 0; i < details.length; i++) {
      const p = details[i];
      reply += `${i + 1}. ${p.pool_name ?? p.pool} — PnL: ${(p.pnl_pct ?? 0).toFixed(2)}%\n`;
    }
    await sendMessage(reply);
    return;
  }

  if (text.startsWith("/close ")) {
    const idx = parseInt(text.split(" ")[1], 10) - 1;
    const positions = await getMyPositions().catch(() => null);
    const details = positions?.positions ?? [];
    if (idx < 0 || idx >= details.length) {
      await sendMessage(`Invalid index. You have ${details.length} open positions. Use /positions to list.`);
      return;
    }
    const p = details[idx];
    await sendMessage(`Closing position ${idx + 1}: ${p.pool_name ?? p.pool}...`);
    const { closePosition } = await import("./tools/dlmm.js");
    try {
      const result = await closePosition({ position_address: p.position_address });
      await sendMessage(`Closed: ${JSON.stringify(result)}`);
    } catch (error: unknown) {
      await sendMessage(`Close failed: ${(error as Error).message}`);
    }
    return;
  }

  if (text.startsWith("/set ")) {
    const parts = text.split(" ");
    const idx = parseInt(parts[1], 10) - 1;
    const note = parts.slice(2).join(" ");
    const positions = await getMyPositions().catch(() => null);
    const details = positions?.positions ?? [];
    if (idx < 0 || idx >= details.length) {
      await sendMessage(`Invalid index. You have ${details.length} open positions. Use /positions to list.`);
      return;
    }
    const { executeTool } = await import("./tools/executor.js");
    await executeTool("set_position_note", { position_address: details[idx].position_address, instruction: note });
    await sendMessage(`Note set on position ${idx + 1}: ${note}`);
    return;
  }

  if (text === "/help" || text === "help") {
    await sendMessage(
      "Available commands:\n"
      + "  /positions          List open positions\n"
      + "  /close <n>          Close position by index\n"
      + "  /set <n> <note>     Set note on position\n"
      + "  /update             Update bot via git pull + restart\n"
      + "  /help               Show this help\n\n"
      + "Natural language examples:\n"
      + "  Find the best pools to deploy\n"
      + "  Close position 1\n"
      + "  What is my wallet balance?\n"
      + "  Show performance report\n"
      + "  Swap all tokens to SOL"
    );
    return;
  }

  if (text === "/update") {
    if (process.env.ALLOW_SELF_UPDATE !== "true") {
      await sendMessage("❌ Self-update is disabled. Set ALLOW_SELF_UPDATE=true in env to enable.");
      return;
    }
    await sendMessage("🔄 Updating via git pull...");
    try {
      const result = execSync("git pull", { cwd: process.cwd(), encoding: "utf8" }).trim();
      await sendMessage(`✅ Update complete:\n${result.slice(0, 500)}\n\nRestarting in 3s...`);
      setTimeout(() => {
        const child = spawn(process.execPath, process.argv.slice(1), {
          detached: true,
          stdio: "inherit",
          cwd: process.cwd(),
        });
        child.unref();
        process.exit(0);
      }, 3000);
    } catch (error: unknown) {
      await sendMessage(`❌ Update failed: ${(error as Error).message}`);
    }
    return;
  }

  const telegramSession: Array<{ role: string; content: string }> = [];
  try {
    const typing = await import("./services/telegram.js").then(m => m.createTypingIndicator());
    try {
      const result = await agentLoop(text, undefined, telegramSession, "GENERAL");
      typing.stop();
      const response = stripMarkdown(stripThink(result.content) ?? "");
      await sendMessage(response ?? "No response from agent.");
    } catch {
      typing.stop();
      await sendMessage("Agent error. Check logs for details.");
    }
  } catch {
    await sendMessage("Failed to process message.");
  }
}

function startTelegramBot(): void {
  if (!telegramEnabled()) return;
  startPolling(async (msg: any) => {
    await handleTelegramMessage(msg);
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
startTelegramBot();

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
