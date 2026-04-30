import * as path from "path";
import { fileURLToPath } from "url";
import { log } from "../logger/logger.js";
import { loadJson, saveJson } from "./state-utils";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DECISION_LOG_FILE = path.join(__dirname, "..", "..", "decision-log.json");
const MAX_DECISIONS = 100;

interface DecisionEntry {
  id: string;
  ts: string;
  type: string;
  actor: string;
  pool: string | null;
  pool_name: string | null;
  position: string | null;
  summary: string | null;
  reason: string | null;
  risks: string[];
  metrics: Record<string, unknown>;
  rejected: string[];
}

interface DecisionLog {
  decisions: DecisionEntry[];
}

interface AppendDecisionParams {
  type?: string;
  actor?: string;
  pool?: string | null;
  pool_name?: string | null;
  position?: string;
  summary?: string;
  reason?: string;
  risks?: unknown[];
  metrics?: Record<string, unknown>;
  rejected?: unknown[];
}

function load(): DecisionLog {
  return loadJson<DecisionLog>(DECISION_LOG_FILE, { decisions: [] });
}

function save(data: DecisionLog): void {
  saveJson(DECISION_LOG_FILE, data);
}

function sanitize(value: unknown, maxLen = 280): string | null {
  if (value == null) return null;
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLen) || null;
}

export function appendDecision(entry: AppendDecisionParams): DecisionEntry {
  const data = load();
  const decision: DecisionEntry = {
    id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    type: entry.type || "note",
    actor: entry.actor || "GENERAL",
    pool: entry.pool || null,
    pool_name: sanitize(entry.pool_name || entry.pool, 120),
    position: entry.position || null,
    summary: sanitize(entry.summary),
    reason: sanitize(entry.reason, 500),
    risks: Array.isArray(entry.risks) ? entry.risks.map((r) => sanitize(r, 140)).filter((risk): risk is string => Boolean(risk)).slice(0, 6) : [],
    metrics: entry.metrics || {},
    rejected: Array.isArray(entry.rejected) ? entry.rejected.map((r) => sanitize(r, 180)).filter((reason): reason is string => Boolean(reason)).slice(0, 8) : [],
  };
  data.decisions.unshift(decision);
  data.decisions = data.decisions.slice(0, MAX_DECISIONS);
  save(data);
  return decision;
}

export function getRecentDecisions(limit = 10): DecisionEntry[] {
  const data = load();
  return (data.decisions || []).slice(0, limit);
}

export function getDecisionSummary(limit = 6): string {
  const decisions = getRecentDecisions(limit);
  if (!decisions.length) return "No recent structured decisions yet.";
  return decisions.map((d, i) => {
    const bits = [
      `${i + 1}. [${d.actor}] ${d.type.toUpperCase()} ${d.pool_name || d.pool || "unknown pool"}`,
      d.summary ? `summary: ${d.summary}` : null,
      d.reason ? `reason: ${d.reason}` : null,
      d.risks?.length ? `risks: ${d.risks.join(", ")}` : null,
      d.rejected?.length ? `rejected: ${d.rejected.join(" | ")}` : null,
    ].filter(Boolean);
    return bits.join(" | ");
  }).join("\n");
}
