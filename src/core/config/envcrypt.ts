import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import crypto from "crypto";

const DEFAULT_ENV_PATH = path.join(process.cwd(), ".env");
const DEFAULT_KEY_PATH = path.join(process.cwd(), ".envrypt");

function isEncryptedMarker(line: string): boolean {
  return line.trim().toLowerCase() === "# encrypted";
}

function parseEncryptedKeys(filePath: string): Set<string> {
  if (!fs.existsSync(filePath)) return new Set();

  const encrypted = new Set<string>();
  let encryptedNext = false;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      encryptedNext = false;
      continue;
    }
    if (isEncryptedMarker(trimmed)) {
      encryptedNext = true;
      continue;
    }
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && encryptedNext) encrypted.add(match[1]);
    encryptedNext = false;
  }
  return encrypted;
}

function getEnvcryptKey(keyPath = DEFAULT_KEY_PATH): string | null {
  const key =
    process.env.ENVRYPT_KEY ||
    process.env.ENVCRYPT_KEY ||
    (fs.existsSync(keyPath) ? fs.readFileSync(keyPath, "utf8").trim() : "");

  if (!key) return null;
  if (key.length < 8) {
    throw new Error("Envrypt encryption key must be at least 8 characters long.");
  }
  return key;
}

function shouldEncryptEnvKey(envKey: string): boolean {
  return envKey.endsWith("_KEY") ||
    envKey.startsWith("ENVRIPT_") ||
    /(?:PRIVATE|SECRET|TOKEN|PASSPHRASE|PASSWORD|MNEMONIC)/i.test(envKey);
}

export function envryptEncrypt(value: string | Buffer, key: string): string {
  const iv = crypto.randomBytes(12);
  const derivedKey = crypto.scryptSync(key, "envcrypt-salt", 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

export function envryptDecrypt(value: string, key: string): string {
  const combined = Buffer.from(String(value), "base64");
  const iv = combined.subarray(0, 12);
  const tag = combined.subarray(-16);
  const encrypted = combined.subarray(12, -16);
  const derivedKey = crypto.scryptSync(key, "envcrypt-salt", 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function loadEnv({ envPath = DEFAULT_ENV_PATH, keyPath = DEFAULT_KEY_PATH, override = false } = {}): { encryptedKeys: string[] } {
  dotenv.config({ path: envPath, override, quiet: true });

  const encryptedKeys = parseEncryptedKeys(envPath);
  if (encryptedKeys.size === 0) return { encryptedKeys: [] };

  const key = getEnvcryptKey(keyPath);
  if (!key) {
    throw new Error(
      `Encrypted env values found in ${envPath}, but no envrypt key was provided. ` +
        "Create .envrypt or set ENVRYPT_KEY / ENVCRYPT_KEY.",
    );
  }

  for (const envKey of encryptedKeys) {
    const value = process.env[envKey];
    if (value == null || value === "") continue;
    process.env[envKey] = envryptDecrypt(value, key);
  }

  return { encryptedKeys: [...encryptedKeys] };
}

export function encryptEnvRaw({
  rawPath = path.join(process.cwd(), ".env.raw"),
  outPath = DEFAULT_ENV_PATH,
  keyPath = DEFAULT_KEY_PATH,
} = {}): { rawPath: string; outPath: string } {
  if (!fs.existsSync(rawPath)) {
    throw new Error(`No ${rawPath} file found.`);
  }

  const key = getEnvcryptKey(keyPath);
  if (!key) {
    throw new Error("Create .envrypt or set ENVRYPT_KEY / ENVCRYPT_KEY before encrypting.");
  }

  const parsed = dotenv.parse(fs.readFileSync(rawPath, "utf8"));
  const lines = ["# Envrypt managed environment file.", ""];
  for (const [envKey, value] of Object.entries(parsed)) {
    if (shouldEncryptEnvKey(envKey)) {
      lines.push("# encrypted");
      lines.push(`${envKey}=${envryptEncrypt(value, key)}`, "");
    } else {
      lines.push(`${envKey}=${value}`);
    }
  }

  fs.writeFileSync(outPath, `${lines.join("\n").replace(/\n+$/, "")}\n`);
  return { rawPath, outPath };
}

loadEnv();
