import { describe, it, expect, beforeEach, vi } from "vitest";

// Save original env
const originalToken = process.env.TELEGRAM_BOT_TOKEN;
const originalChatId = process.env.TELEGRAM_CHAT_ID;
const originalAllowedUsers = process.env.TELEGRAM_ALLOWED_USER_IDS;

// Mock fetch globally
global.fetch = vi.fn();

vi.mock("../src/core/logger/logger.js", () => ({
  log: vi.fn(),
}));

describe("telegram.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "123456";
    process.env.TELEGRAM_ALLOWED_USER_IDS = "111,222";
    // Reload module to pick up env changes
  });

  afterEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
    process.env.TELEGRAM_CHAT_ID = originalChatId;
    process.env.TELEGRAM_ALLOWED_USER_IDS = originalAllowedUsers;
  });

  describe("isAuthorizedIncomingMessage", () => {
    it("should reject message with wrong chat id", async () => {
      const { isAuthorizedIncomingMessage } = await import("../src/services/telegram.js");
      const result = isAuthorizedIncomingMessage({
        chat: { id: 999, type: "private" },
        from: { id: 111 },
      });
      expect(result).toBe(false);
    });

    it("should reject message from unauthorized user", async () => {
      const { isAuthorizedIncomingMessage } = await import("../src/services/telegram.js");
      const result = isAuthorizedIncomingMessage({
        chat: { id: 123456, type: "private" },
        from: { id: 999 }, // Not in allowed list
      });
      expect(result).toBe(false);
    });

    it("should reject when TELEGRAM_ALLOWED_USER_IDS is empty", async () => {
      process.env.TELEGRAM_ALLOWED_USER_IDS = "";
      // Need to re-import to pick up env change
      vi.resetModules();
      const { isAuthorizedIncomingMessage } = await import("../src/services/telegram.js");
      const result = isAuthorizedIncomingMessage({
        chat: { id: 123456, type: "private" },
        from: { id: 111 },
      });
      expect(result).toBe(false);
    });
  });

  describe("isEnabled", () => {
    it("should return true when token is set", async () => {
      const { isEnabled } = await import("../src/services/telegram.js");
      expect(isEnabled()).toBe(true);
    });

    it("should return false when token is not set", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "";
      vi.resetModules();
      const { isEnabled } = await import("../src/services/telegram.js");
      expect(isEnabled()).toBe(false);
    });
  });

  describe("sendMessage", () => {
    it("should return null when token is not set", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "";
      vi.resetModules();
      const { sendMessage } = await import("../src/services/telegram.js");
      const result = await sendMessage("test");
      expect(result).toBeNull();
    });

    it("should call fetch when token is set", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.TELEGRAM_CHAT_ID = "123456";
      vi.resetModules();
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const { sendMessage } = await import("../src/services/telegram.js");
      await sendMessage("test message");
      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
