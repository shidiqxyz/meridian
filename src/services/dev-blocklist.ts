/**
 * Dev (deployer) blocklist — deployer wallet addresses that should never be deployed into.
 *
 * Agent/user can add deployers via Telegram ("block this deployer").
 * Screening hard-filters any pool whose base token was deployed by a blocked wallet
 * before the pool list reaches the LLM.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { log } from "../core/logger/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOCKLIST_FILE = path.join(__dirname, "..", "dev-blocklist.json");

interface BlocklistEntry {
  label: string;
  reason: string;
  added_at: string;
}

interface BlocklistDB {
  [wallet: string]: BlocklistEntry;
}

interface BlockDevParams {
  wallet: string;
  reason: string;
  label?: string;
}

interface UnblockDevParams {
  wallet: string;
}

function load(): BlocklistDB {
  if (!fs.existsSync(BLOCKLIST_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(BLOCKLIST_FILE, "utf8"));
  } catch (error: any) {
    log("dev_blocklist_error", `Invalid ${BLOCKLIST_FILE}: ${error.message}`);
    throw new Error(`Safety blocklist is unreadable: ${BLOCKLIST_FILE}`);
  }
}

function save(data: BlocklistDB): void {
  fs.writeFileSync(BLOCKLIST_FILE, JSON.stringify(data, null, 2));
}

export function isDevBlocked(devWallet: string): boolean {
  if (!devWallet) return false;
  return !!load()[devWallet];
}

export function getBlockedDevs(): BlocklistDB {
  return load();
}

export function blockDev({ wallet, reason, label }: BlockDevParams): { error?: string; already_blocked?: boolean; blocked?: boolean; wallet?: string; label?: string; reason?: string } {
  if (!wallet) return { error: "wallet required" };
  const db = load();

  if (db[wallet]) return { already_blocked: true, wallet, label: db[wallet].label, reason: db[wallet].reason };

  db[wallet] = {
    label: label || "unknown",
    reason: reason || "no reason provided",
    added_at: new Date().toISOString(),
  };

  save(db);
  log("dev_blocklist", `Blocked deployer ${label || wallet}: ${reason}`);
  return { blocked: true, wallet, label, reason };
}

export function unblockDev({ wallet }: UnblockDevParams): { error?: string; unblocked?: boolean; wallet?: string; was?: BlocklistEntry } {
  if (!wallet) return { error: "wallet required" };
  const db = load();

  if (!db[wallet]) return { error: `Wallet ${wallet} not on dev blocklist` };
  const entry = db[wallet];
  delete db[wallet];
  save(db);
  log("dev_blocklist", `Removed deployer ${entry.label || wallet} from blocklist`);
  return { unblocked: true, wallet, was: entry };
}

export function listBlockedDevs(): { count: number; blocked_devs: Array<{ wallet: string } & BlocklistEntry> } {
  const db = load();
  const entries = Object.entries(db).map(([wallet, info]) => ({
    wallet,
    ...info,
  }));

  return { count: entries.length, blocked_devs: entries };
}
