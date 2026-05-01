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
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ""))
    .replace(/\|[\s-]+\|/g, "")
    .replace(/\|/g, " ")
    .replace(/\n{3,}/g, "\n\n");
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
        managementBusy = false;
        void runScreeningCycle().catch((error: Error) => log("cron_error", `Triggered screening failed: ${error.message}`));
        return report;
      }

    const positionsSummary = positions.map((p: any, i: number) => {
      const name = p.pool_name || p.pair || p.pool || "Unknown";
      const pnlPct = p.pnl_pct ?? p.pnlPct ?? 0;
      const pnlUsd = p.pnl_usd ?? p.pnlUsd ?? 0;
      const inRange = p.in_range ?? true;
      return `${i + 1}. ${name} — PnL: ${pnlPct.toFixed(2)}% ($${pnlUsd.toFixed(2)}) — ${inRange ? "In Range" : "Out of Range"}`;
    }).join("\n");

    const prompt = `Management cycle: Evaluate these open positions and take action (STAY, CLOSE, CLAIM FEES, etc.):\n\n${positionsSummary}\n\nWhat action do you recommend for each position?`;
    const result = await agentLoop(prompt, undefined, [], "MANAGER");
    report = stripMarkdown(stripThink(result.content) ?? "Management cycle complete.");
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

const telegramSession: Array<{ role: string; content: string }> = [];
const telegramBusy = { value: false };

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

  if (text === "/start") {
    await sendHTML(
      "👋 <b>Welcome to Meridian DLMM LP Agent!</b>\n\n" +
      "I manage Meteora DLMM liquidity positions for you.\n\n" +
      "<b>How to use:</b>\n" +
      "• Send natural language messages — I have a persistent REPL session with context memory\n" +
      "• Use /positions to see open positions\n" +
      "• Use /close &lt;n&gt; to close a position by index\n" +
      "• Use /set &lt;n&gt; &lt;note&gt; to tag a position\n" +
      "• Use /clear to reset my conversation memory\n" +
      "• Use /help for full command list\n\n" +
      "<b>Examples you can send:</b>\n" +
      "• Find the best pools to deploy\n" +
      "• What is my wallet balance?\n" +
      "• Show performance report\n" +
      "• Close position 1\n" +
      "• Swap all tokens to SOL\n\n" +
      "Type / to see all commands in the menu."
    );
    return;
  }

  if (text === "/positions") {
    const positions = await getMyPositions().catch(() => null);
    const count = positions?.total_positions ?? 0;
    const details = positions?.positions ?? [];
    if (count === 0) {
      await sendMessage("No open positions.");
      return;
    }
    let reply = `<b>Open positions: ${count}</b>\n\n`;
    for (let i = 0; i < details.length; i++) {
      const p = details[i];
      const name = p.pool_name || p.pair || p.pool || "Unknown";
      const pnlPct = p.pnl_pct ?? p.pnlPct ?? 0;
      const pnlUsd = p.pnl_usd ?? p.pnlUsd ?? 0;
      const totalUsd = p.total_value_usd ?? p.totalValueUsd ?? 0;
      const unclaimedFees = p.unclaimed_fees_usd ?? p.unclaimedFeesUsd ?? 0;
      const pnlEmoji = pnlPct >= 0 ? "📈" : "📉";
      reply += `<b>${i + 1}. ${name}</b>\n`;
      reply += `   Value: $${totalUsd.toFixed(2)}\n`;
      reply += `   PnL: ${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%) ${pnlEmoji}\n`;
      if (unclaimedFees > 0) {
        reply += `   Unclaimed fees: $${unclaimedFees.toFixed(2)}\n`;
      }
      reply += "\n";
    }
    await sendHTML(reply.trim());
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
    try {
      const { executeTool } = await import("./tools/executor.js");
      const result = await executeTool("close_position", { position_address: p.position_address });
      const pnlPct = Number(result.pnl_pct ?? 0);
      const pnlUsd = Number(result.pnl_usd ?? 0);
      const solReceived = Number(result.sol_received ?? 0);
      const reply = `🔒 Closed ${p.pool_name ?? p.pool}\nPnL: ${pnlUsd >= 0 ? "+" : ""}$${Math.abs(pnlUsd).toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)\n${solReceived > 0 ? `✅ Auto-swapped to ${solReceived.toFixed(4)} SOL` : ""}`;
      await sendHTML(reply);
      // Trigger screening cycle after close to find new positions
      void runScreeningCycle().catch((error: Error) => log("cron_error", `Triggered screening failed: ${error.message}`));
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
    await sendHTML(
      "<b>Available commands:</b>\n"
      + "/deploy — Pick best pool and deploy\n"
      + "/balance — Check wallet balance\n"
      + "/swap — Swap all tokens to SOL\n"
      + "/positions — List open positions\n"
      + "/close &lt;n&gt; — Close position by index\n"
      + "/set &lt;n&gt; &lt;note&gt; — Set note on position\n"
      + "/clear — Clear Telegram REPL session\n"
      + "/update — Update bot via git pull + restart\n"
      + "/help — Show this help\n\n"
      + "<b>Natural language messages</b> use REPL with persistent session history.\n"
      + "<b>Examples:</b>\n"
      + "• Find the best pools to deploy\n"
      + "• Close position 1\n"
      + "• What is my wallet balance?\n"
      + "• Swap all tokens to SOL"
    );
    return;
  }

    if (text === "/deploy") {
    try {
      const { executeTool } = await import("./tools/executor.js");
      const best = await executeTool("pick_best_candidate", {});
      const poolAddress = String(best.pool_address || best.pool || "");
      if (!poolAddress) throw new Error("No pool found");
      await sendMessage(`Deploying to ${best.pool_name || best.pool || "Unknown"}...`);
      const result = await executeTool("deploy_position", { pool_address: poolAddress });
      const name = String(result.pool_name || result.pool_address || poolAddress);
      const amount = Number(result.amount_sol ?? result.amount_y ?? 0);
      const position = String(result.position || "");
      const txs = (result.tx || result.txs || []) as any[];
      const tx = String(Array.isArray(txs) ? txs[0] : txs || "");
      const txShort = tx ? `${tx.slice(0, 8)}...${tx.slice(-8)}` : "N/A";
      await sendHTML(`✅ Deployed ${name}\nAmount: ${amount} SOL\nPosition: ${position.slice(0, 8)}...\nTx: https://solscan.io/tx/${tx}\nClick: ${txShort}`);
    } catch (error: unknown) {
      await sendMessage(`Deploy failed: ${(error as Error).message}`);
    }
    return;
  }

  if (text === "/balance") {
    try {
      const { getWalletBalances } = await import("./tools/wallet.js");
      const balances = await getWalletBalances();
      let reply = `<b>Wallet Balance:</b>\n`;
      reply += `SOL: ${balances.sol} ($${balances.sol_usd?.toFixed(2)})\n`;
      reply += `Total USD: $${balances.total_usd?.toFixed(2)}\n\n`;
      if (balances.tokens?.length > 0) {
        reply += `<b>Other tokens:</b>\n`;
        for (const t of balances.tokens) {
          const mintShort = t.mint ? t.mint.slice(0, 8) : "unknown";
        reply += `${t.symbol || mintShort}: ${t.balance} ($${t.usd_value?.toFixed(2)})\n`;
        }
      }
      await sendHTML(reply.trim());
    } catch (error: unknown) {
      await sendMessage(`Balance check failed: ${(error as Error).message}`);
    }
    return;
  }

  if (text === "/swap") {
    await sendMessage("Swapping all tokens to SOL...");
    try {
      const { executeTool } = await import("./tools/executor.js");
      const result = await executeTool("swap_token", { from: "ALL", to: "SOL", amount: 0 });
      if (result.error) {
        await sendMessage(`Swap skipped: ${result.error}`);
      } else {
        await sendMessage(`✅ Swap complete!`);
      }
    } catch (error: unknown) {
      await sendMessage(`Swap failed: ${(error as Error).message}`);
    }
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

  if (text === "/clear") {
    telegramSession.length = 0;
    await sendMessage("Telegram REPL session cleared.");
    return;
  }

  if (telegramBusy.value) {
    await sendMessage("Agent is busy processing another request. Please wait...");
    return;
  }

  telegramBusy.value = true;
  try {
    log("telegram_repl", `User: ${text}`);
    const typing = await import("./services/telegram.js").then(m => m.createTypingIndicator());
    try {
      const result = await agentLoop(text, undefined, telegramSession, "GENERAL");
      typing.stop();
      const response = stripMarkdown(stripThink(result.content) ?? "");
      telegramSession.push({ role: "user", content: text });
      telegramSession.push({ role: "assistant", content: response ?? "" });
      await sendMessage(response ?? "No response from agent.");
      log("telegram_repl", `Agent: ${response}`);
    } catch {
      typing.stop();
      await sendMessage("Agent error. Check logs for details.");
    }
  } catch (error: unknown) {
    await sendMessage(`Error: ${(error as Error).message}`);
  } finally {
    telegramBusy.value = false;
  }
}

function startTelegramBot(): void {
  if (!telegramEnabled()) return;
  startPolling(async (msg: any) => {
    await handleTelegramMessage(msg);
  });
  void import("./services/telegram.js").then(m => m.registerCommands());
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
