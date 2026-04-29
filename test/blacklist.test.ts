import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { addToBlacklist, removeFromBlacklist, listBlacklist } from "../src/services/token-blacklist.js";
import { blockDev, unblockDev, listBlockedDevs } from "../src/services/dev-blocklist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLACKLIST_FILE = path.join(__dirname, "..", "src", "token-blacklist.json");
const DEV_BLOCKLIST_FILE = path.join(__dirname, "..", "src", "dev-blocklist.json");

function clearBlacklistFile() {
  if (fs.existsSync(BLACKLIST_FILE)) fs.writeFileSync(BLACKLIST_FILE, "{}");
}
function clearDevBlocklistFile() {
  if (fs.existsSync(DEV_BLOCKLIST_FILE)) fs.writeFileSync(DEV_BLOCKLIST_FILE, "{}");
}

describe("token blacklist", () => {
  beforeEach(() => {
    clearBlacklistFile();
  });

  afterEach(() => {
    clearBlacklistFile();
  });

  it("starts with empty blacklist", () => {
    expect(listBlacklist().blacklist).toHaveLength(0);
  });

  it("adds and lists blacklisted tokens", () => {
    addToBlacklist({ mint: "FakeMint123", reason: "rug pull" });
    const items = listBlacklist().blacklist;
    expect(items.length).toBeGreaterThan(0);
    const found = items.find((i) => i.mint === "FakeMint123");
    expect(found).toBeDefined();
    expect(found?.reason).toBe("rug pull");
  });

  it("removes blacklisted tokens", () => {
    addToBlacklist({ mint: "ToRemove", reason: "test" });
    expect(listBlacklist().blacklist.some((i) => i.mint === "ToRemove")).toBe(true);
    removeFromBlacklist({ mint: "ToRemove" });
    expect(listBlacklist().blacklist.some((i) => i.mint === "ToRemove")).toBe(false);
  });

  it("does not duplicate entries", () => {
    addToBlacklist({ mint: "DupMint", reason: "first" });
    addToBlacklist({ mint: "DupMint", reason: "second" });
    const items = listBlacklist().blacklist.filter((i) => i.mint === "DupMint");
    expect(items).toHaveLength(1);
  });
});

describe("developer blocklist", () => {
  beforeEach(() => {
    clearDevBlocklistFile();
  });

  afterEach(() => {
    clearDevBlocklistFile();
  });

  it("starts empty", () => {
    expect(listBlockedDevs().blocked_devs).toHaveLength(0);
  });

  it("blocks and lists developers", () => {
    blockDev({ wallet: "DevWallet123", reason: "farm deployer" });
    const items = listBlockedDevs().blocked_devs;
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.wallet === "DevWallet123")).toBe(true);
  });

  it("unblocks developers", () => {
    blockDev({ wallet: "ToUnblock", reason: "test" });
    expect(listBlockedDevs().blocked_devs.some((i) => i.wallet === "ToUnblock")).toBe(true);
    unblockDev({ wallet: "ToUnblock" });
    expect(listBlockedDevs().blocked_devs.some((i) => i.wallet === "ToUnblock")).toBe(false);
  });
});
