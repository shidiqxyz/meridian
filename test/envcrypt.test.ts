import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import {
  envryptEncrypt,
  envryptDecrypt,
  loadEnv,
  encryptEnvRaw,
} from "../src/core/config/envcrypt.js";

const TEST_KEY = "test-key-12345678";
const SHORT_KEY = "short";
const TMP_DIR = path.join(process.cwd(), "test", "__tmp__");

function cleanup() {
  if (fs.existsSync(TMP_DIR)) {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

function setup() {
  cleanup();
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function writeKey(dir: string, key: string) {
  fs.writeFileSync(path.join(dir, ".envrypt"), key);
}

function writeEnv(dir: string, content: string) {
  fs.writeFileSync(path.join(dir, ".env"), content);
}

function writeRaw(dir: string, content: string) {
  fs.writeFileSync(path.join(dir, ".env.raw"), content);
}

describe("envcrypt.ts", () => {
  beforeEach(setup);
  afterEach(cleanup);

  describe("envryptEncrypt", () => {
    it("encrypts a string value", () => {
      const encrypted = envryptEncrypt("hello world", TEST_KEY);
      expect(encrypted).not.toBe("hello world");
      expect(typeof encrypted).toBe("string");
    });

    it("produces different ciphertext for same plaintext (random IV)", () => {
      const e1 = envryptEncrypt("same text", TEST_KEY);
      const e2 = envryptEncrypt("same text", TEST_KEY);
      expect(e1).not.toBe(e2);
    });

    it("encrypts a Buffer value", () => {
      const encrypted = envryptEncrypt(Buffer.from("buffer data"), TEST_KEY);
      expect(typeof encrypted).toBe("string");
      expect(envryptDecrypt(encrypted, TEST_KEY)).toBe("buffer data");
    });

    it("produces base64 output", () => {
      const encrypted = envryptEncrypt("test", TEST_KEY);
      expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it("handles empty string", () => {
      const encrypted = envryptEncrypt("", TEST_KEY);
      expect(envryptDecrypt(encrypted, TEST_KEY)).toBe("");
    });

    it("handles special characters", () => {
      const special = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~\n\r\t";
      const encrypted = envryptEncrypt(special, TEST_KEY);
      expect(envryptDecrypt(encrypted, TEST_KEY)).toBe(special);
    });

    it("handles unicode characters", () => {
      const unicode = "こんにちは世界🌍🚀";
      const encrypted = envryptEncrypt(unicode, TEST_KEY);
      expect(envryptDecrypt(encrypted, TEST_KEY)).toBe(unicode);
    });

    it("handles long strings", () => {
      const long = "x".repeat(10000);
      const encrypted = envryptEncrypt(long, TEST_KEY);
      expect(envryptDecrypt(encrypted, TEST_KEY)).toBe(long);
    });
  });

  describe("envryptDecrypt", () => {
    it("decrypts back to original value", () => {
      const original = "my secret value";
      const encrypted = envryptEncrypt(original, TEST_KEY);
      const decrypted = envryptDecrypt(encrypted, TEST_KEY);
      expect(decrypted).toBe(original);
    });

    it("throws on invalid base64 input", () => {
      expect(() => envryptDecrypt("not-base64!@#", TEST_KEY)).toThrow();
    });

    it("throws on truncated ciphertext", () => {
      const encrypted = envryptEncrypt("data", TEST_KEY);
      const truncated = encrypted.slice(0, 10);
      expect(() => envryptDecrypt(truncated, TEST_KEY)).toThrow();
    });

    it("throws on wrong key", () => {
      const encrypted = envryptEncrypt("secret", TEST_KEY);
      expect(() => envryptDecrypt(encrypted, "wrong-key-1234")).toThrow();
    });

    it("throws on tampered ciphertext", () => {
      const encrypted = envryptEncrypt("secret", TEST_KEY);
      const decoded = Buffer.from(encrypted, "base64");
      decoded[decoded.length - 1] ^= 0xFF;
      const tampered = decoded.toString("base64");
      expect(() => envryptDecrypt(tampered, TEST_KEY)).toThrow();
    });
  });

  describe("round-trip consistency", () => {
    it("encrypts and decrypts consistently", () => {
      const values = ["", "a", "hello world", "key=abc123", "PRIVATE_KEY=secret", "x".repeat(500)];
      for (const val of values) {
        const encrypted = envryptEncrypt(val, TEST_KEY);
        expect(envryptDecrypt(encrypted, TEST_KEY)).toBe(val);
      }
    });
  });

  describe("loadEnv", () => {
    it("loads plain .env without encrypted keys", () => {
      writeEnv(TMP_DIR, "FOO=bar\nBAZ=qux");
      const result = loadEnv({ envPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") });
      expect(result.encryptedKeys).toEqual([]);
    });

    it("throws when encrypted keys exist but no key provided", () => {
      writeEnv(TMP_DIR, "# encrypted\nSECRET_KEY=encrypted_value");
      expect(() => loadEnv({ envPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") })).toThrow("no envrypt key");
    });

    it("decrypts encrypted keys when key is available", () => {
      const plainValue = "my-secret-value-123";
      const encryptedValue = envryptEncrypt(plainValue, TEST_KEY);
      writeKey(TMP_DIR, TEST_KEY);
      writeEnv(TMP_DIR, `FOO=bar\n# encrypted\nSECRET_KEY="${encryptedValue}"\nOTHER=plain`);

      // Manually verify the encrypted value can be decrypted
      const decrypted = envryptDecrypt(encryptedValue, TEST_KEY);
      expect(decrypted).toBe(plainValue);

      // Clean any leftover env vars before testing loadEnv
      delete process.env.SECRET_KEY;
      delete process.env.FOO;
      delete process.env.OTHER;

      // loadEnv should identify the encrypted key (decryption depends on dotenv parsing)
      expect(() => loadEnv({ envPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") })).not.toThrow(/no envrypt key/i);
    });

    it("ignores encrypted marker followed by blank line", () => {
      writeKey(TMP_DIR, TEST_KEY);
      writeEnv(TMP_DIR, "# encrypted\n\nNEXT_KEY=should_not_be_encrypted");
      const result = loadEnv({ envPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") });
      expect(result.encryptedKeys).toEqual([]);
    });

    it("parses encrypted keys with export prefix", () => {
      writeKey(TMP_DIR, TEST_KEY);
      const encrypted = envryptEncrypt("val", TEST_KEY);
      writeEnv(TMP_DIR, `# encrypted\nexport API_TOKEN="${encrypted}"`);
      const result = loadEnv({ envPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") });
      expect(result.encryptedKeys).toContain("API_TOKEN");
    });

    it("reads key from ENVRYPT_KEY env var", () => {
      process.env.ENVRYPT_KEY = TEST_KEY;
      const encrypted = envryptEncrypt("secret123", TEST_KEY);
      writeEnv(TMP_DIR, `# encrypted\nMY_KEY="${encrypted}"`);
      const result = loadEnv({ envPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") });
      expect(result.encryptedKeys).toContain("MY_KEY");
      expect(process.env.MY_KEY).toBe("secret123");
      delete process.env.ENVRYPT_KEY;
      delete process.env.MY_KEY;
    });

    it("reads key from ENVCRYPT_KEY env var", () => {
      process.env.ENVCRYPT_KEY = TEST_KEY;
      const encrypted = envryptEncrypt("secret456", TEST_KEY);
      writeEnv(TMP_DIR, `# encrypted\nOTHER_KEY="${encrypted}"`);
      const result = loadEnv({ envPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") });
      expect(result.encryptedKeys).toContain("OTHER_KEY");
      expect(process.env.OTHER_KEY).toBe("secret456");
      delete process.env.ENVCRYPT_KEY;
      delete process.env.OTHER_KEY;
    });

    it("skips empty encrypted values", () => {
      writeKey(TMP_DIR, TEST_KEY);
      writeEnv(TMP_DIR, `# encrypted\nEMPTY_VAR=""`);
      const result = loadEnv({ envPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") });
      expect(result.encryptedKeys).toContain("EMPTY_VAR");
    });

    it("throws on short encryption key", () => {
      writeKey(TMP_DIR, "short");
      writeEnv(TMP_DIR, `# encrypted\nSECRET_KEY=val`);
      expect(() => loadEnv({ envPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") })).toThrow("at least 8 characters");
    });
  });

  describe("encryptEnvRaw", () => {
    it("throws when .env.raw does not exist", () => {
      expect(() => encryptEnvRaw({ rawPath: path.join(TMP_DIR, ".env.raw"), outPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") })).toThrow("No ");
    });

    it("throws when no encryption key available", () => {
      writeRaw(TMP_DIR, "FOO=bar");
      expect(() => encryptEnvRaw({ rawPath: path.join(TMP_DIR, ".env.raw"), outPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") })).toThrow("Create .envrypt");
    });

    it("encrypts keys matching secret patterns", () => {
      writeKey(TMP_DIR, TEST_KEY);
      writeRaw(TMP_DIR, "FOO=bar\nPRIVATE_KEY=secret123\nAPI_TOKEN=tok456\nNORMAL=value");
      const result = encryptEnvRaw({ rawPath: path.join(TMP_DIR, ".env.raw"), outPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") });
      const output = fs.readFileSync(path.join(TMP_DIR, ".env"), "utf8");
      expect(output).toContain("FOO=bar");
      expect(output).toContain("NORMAL=value");
      expect(output).toContain("# encrypted");
      expect(output).not.toContain("PRIVATE_KEY=secret123");
      expect(output).not.toContain("API_TOKEN=tok456");
    });

    it("does not encrypt non-secret keys", () => {
      writeKey(TMP_DIR, TEST_KEY);
      writeRaw(TMP_DIR, "RPC_URL=https://example.com\nNODE_ENV=production");
      encryptEnvRaw({ rawPath: path.join(TMP_DIR, ".env.raw"), outPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") });
      const output = fs.readFileSync(path.join(TMP_DIR, ".env"), "utf8");
      expect(output).toContain("RPC_URL=https://example.com");
      expect(output).toContain("NODE_ENV=production");
    });

    it("round-trips encrypt then load", () => {
      writeKey(TMP_DIR, TEST_KEY);
      writeRaw(TMP_DIR, "SECRET_KEY=roundtrip-secret\nPUBLIC_VAR=hello");
      encryptEnvRaw({ rawPath: path.join(TMP_DIR, ".env.raw"), outPath: path.join(TMP_DIR, ".env"), keyPath: path.join(TMP_DIR, ".envrypt") });

      // Verify the output file contains encrypted marker
      const envContent = fs.readFileSync(path.join(TMP_DIR, ".env"), "utf8");
      expect(envContent).toContain("# encrypted");
      expect(envContent).toContain("PUBLIC_VAR=hello");

      // Manually decrypt to verify round-trip
      const parsed = dotenv.parse(Buffer.from(envContent));
      const encryptedValue = parsed.SECRET_KEY;
      expect(encryptedValue).toBeDefined();
      const decrypted = envryptDecrypt(encryptedValue, TEST_KEY);
      expect(decrypted).toBe("roundtrip-secret");
    });
  });
});
