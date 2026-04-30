import * as fs from "fs";
import { log } from "../logger/logger";

/**
 * Generic JSON file loader with error handling and defaults.
 * Returns default value if file missing or unparseable.
 */
export function loadJson<T>(filePath: string, defaultValue: T): T {
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (error: any) {
    log("state_error", `Failed to read ${filePath}: ${error.message}`);
    return defaultValue;
  }
}

/**
 * Generic JSON file writer with atomic write (write to temp, then rename).
 * Falls back to copy+unlink for Windows where rename may fail due to file locks.
 */
export function saveJson<T>(filePath: string, data: T): void {
  try {
    const content = JSON.stringify(data, null, 2);
    const tmpFile = `${filePath}.tmp`;
    fs.writeFileSync(tmpFile, content);
    try {
      fs.renameSync(tmpFile, filePath);
    } catch {
      // Windows: rename may fail due to file locks, use copy+unlink
      fs.copyFileSync(tmpFile, filePath);
      fs.unlinkSync(tmpFile);
    }
  } catch (error: any) {
    log("state_error", `Failed to write ${filePath}: ${error.message}`);
  }
}
