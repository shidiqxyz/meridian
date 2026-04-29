import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

const LOG_DIR = "./logs";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[LOG_LEVEL] || 1;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = "debug" | "info" | "warn" | "error";

export function log(category: string, message: string): void {
  const level: LogLevel = category.includes("error")
    ? "error"
    : category.includes("warn")
      ? "warn"
      : "info";

  if (LEVELS[level] < currentLevel) return;

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${category.toUpperCase()}] ${message}`;

  console.log(line);

  const dateStr = timestamp.split("T")[0];
  const logFile = path.join(LOG_DIR, `agent-${dateStr}.log`);
  fsPromises.appendFile(logFile, line + "\n").catch((error) => {
    console.error(`Failed to write log file: ${error.message}`);
  });
}

interface ActionRecord {
  tool: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  duration_ms?: number;
  success: boolean;
  [key: string]: unknown;
}

function actionHint(action: ActionRecord): string {
  const args = (action.args || {}) as Record<string, unknown>;
  const result = (action.result || {}) as Record<string, unknown>;
  const asString = (value: unknown, start = 0, end = 8): string =>
    typeof value === "string" ? value.slice(start, end) : "";
  const asNumber = (value: unknown): number | undefined =>
    typeof value === "number" ? value : undefined;
  const asArrayLength = (value: unknown): number | undefined =>
    Array.isArray(value) ? value.length : undefined;

  switch (action.tool) {
    case "deploy_position":
      return ` ${(typeof args.pool_name === "string" ? args.pool_name : asString(args.pool_address))} ${args.amount_sol ?? ""} SOL`;
    case "close_position": {
      const pnlUsd = asNumber(result.pnl_usd);
      const pnlPct = asNumber(result.pnl_pct);
      return ` ${asString(args.position_address)}${pnlUsd != null ? ` | PnL $${pnlUsd >= 0 ? "+" : ""}${pnlUsd} (${pnlPct ?? ""}%)` : ""}`;
    }
    case "claim_fees":
      return ` ${asString(args.position_address)}`;
    case "get_active_bin":
      return ` bin ${asNumber(result.binId) ?? ""}`;
    case "get_pool_detail":
      return ` ${(typeof result.name === "string" ? result.name : asString(args.pool_address)) || ""}`;
    case "get_my_positions":
      return ` ${asNumber(result.total_positions) ?? ""} positions`;
    case "get_wallet_balance":
      return ` ${asNumber(result.sol) ?? ""} SOL`;
    case "get_top_candidates":
      return ` ${asArrayLength(result.candidates) ?? ""} pools`;
    case "swap_token":
      return ` ${args.amount ?? ""} ${asString(args.input_mint, 0, 6)}->SOL`;
    case "update_config":
      return ` ${Object.keys((result.applied as Record<string, unknown> | undefined) || {}).join(", ")}`;
    case "add_lesson":
      return " saved";
    case "clear_lessons":
      return ` cleared ${asNumber(result.cleared) ?? ""}`;
    default:
      return "";
  }
}

export function logAction(action: ActionRecord): void {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, ...action };

  const status = action.success ? "[ok]" : "[x]";
  const dur = action.duration_ms != null ? ` (${action.duration_ms}ms)` : "";
  const hint = actionHint(action);
  console.log(`[${action.tool}] ${status}${hint}${dur}`);

  const dateStr = timestamp.split("T")[0];
  const actionsFile = path.join(LOG_DIR, `actions-${dateStr}.jsonl`);
  fsPromises.appendFile(actionsFile, JSON.stringify(entry) + "\n").catch((error) => {
    console.error(`Failed to write actions file: ${error.message}`);
  });
}
