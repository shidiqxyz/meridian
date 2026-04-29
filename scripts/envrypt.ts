#!/usr/bin/env node
import { encryptEnvRaw, envryptDecrypt } from "../src/core/config/envcrypt.js";

function usage() {
  console.log(`Usage:
  node scripts/envrypt.js encrypt [rawPath] [outPath]
  node scripts/envrypt.js decrypt KEY VALUE

Envrypt key is read from .envrypt, ENVRYPT_KEY, or ENVCRYPT_KEY.`);
}

const [command, first, second] = process.argv.slice(2);

try {
  if (command === "encrypt") {
    const result = encryptEnvRaw({
      rawPath: first || undefined,
      outPath: second || undefined,
    } as any);
    console.log(`Encrypted ${result.rawPath} -> ${result.outPath}`);
  } else if (command === "decrypt") {
    if (!first || !second) {
      usage();
      process.exit(1);
    }
    console.log(envryptDecrypt(second, first));
  } else {
    usage();
    process.exit(command ? 1 : 0);
  }
} catch (error: any) {
  console.error(error.message);
  process.exit(1);
}
