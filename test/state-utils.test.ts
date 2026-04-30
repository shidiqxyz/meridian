import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { loadJson, saveJson } from "../src/core/state/state-utils";

const TEST_FILE = "./test-state-utils.json";
const TEST_FILE_TMP = "./test-state-utils.json.tmp";

describe("state-utils", () => {
  beforeEach(() => {
    // Clean up any leftover test files
    [TEST_FILE, TEST_FILE_TMP].forEach(f => {
      for (let i = 0; i < 3; i++) {
        try { fs.unlinkSync(f); } catch {}
      }
    });
  });

  afterEach(() => {
    [TEST_FILE, TEST_FILE_TMP].forEach(f => {
      for (let i = 0; i < 3; i++) {
        try { fs.unlinkSync(f); } catch {}
      }
    });
  });

  describe("loadJson", () => {
    it("returns default value when file does not exist", () => {
      const defaultValue = { key: "default" };
      const result = loadJson(TEST_FILE, defaultValue);
      expect(result).toEqual(defaultValue);
    });

    it("returns parsed JSON when file exists and is valid", () => {
      const data = { name: "test", value: 42 };
      fs.writeFileSync(TEST_FILE, JSON.stringify(data));
      const result = loadJson<typeof data>(TEST_FILE, {} as any);
      expect(result).toEqual(data);
    });

    it("returns default value when file contains invalid JSON", () => {
      const defaultValue = { key: "default" };
      fs.writeFileSync(TEST_FILE, "invalid json {");
      const result = loadJson(TEST_FILE, defaultValue);
      expect(result).toEqual(defaultValue);
    });

    it("handles different data types", () => {
      expect(loadJson(TEST_FILE, [])).toEqual([]);
      expect(loadJson(TEST_FILE, null)).toBeNull();
      expect(loadJson(TEST_FILE, "string")).toBe("string");
    });
  });

  describe("saveJson", () => {
    it("creates file with valid JSON", () => {
      const data = { test: true, items: [1, 2, 3] };
      saveJson(TEST_FILE, data);
      expect(fs.existsSync(TEST_FILE)).toBe(true);
      const loaded = JSON.parse(fs.readFileSync(TEST_FILE, "utf8"));
      expect(loaded).toEqual(data);
    });

    it("overwrites existing file", () => {
      const data1 = { version: 1 };
      const data2 = { version: 2 };
      saveJson(TEST_FILE, data1);
      saveJson(TEST_FILE, data2);
      const loaded = JSON.parse(fs.readFileSync(TEST_FILE, "utf8"));
      expect(loaded).toEqual(data2);
    });

    it("uses atomic write (tmp file cleaned up)", () => {
      const data = { atomic: true };
      saveJson(TEST_FILE, data);
      expect(fs.existsSync(TEST_FILE_TMP)).toBe(false);
      expect(fs.existsSync(TEST_FILE)).toBe(true);
    });

    it("handles complex nested objects", () => {
      const data = {
        state: { positions: { "abc": { bins: [1, 2, 3] } } },
        meta: { timestamp: new Date().toISOString() }
      };
      saveJson(TEST_FILE, data);
      const loaded = loadJson<typeof data>(TEST_FILE, {} as any);
      expect(loaded.state.positions["abc"].bins).toEqual([1, 2, 3]);
    });
  });
});
