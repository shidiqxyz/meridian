/**
 * Meridian — Interactive setup command
 * Prompts for required environment variables and saves to .env
 */
import readline from "readline";
import fs from "fs";
import path from "path";

const ENV_PATH = path.join(process.cwd(), ".env");

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve));
}

export async function runSetup(): Promise<{ success: boolean; message: string; saved: string[] }> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Load existing values
  const existing: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match) existing[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }

  process.stdout.write("\n=== Meridian Setup ===\n\n");

  const vars = [
    { key: "WALLET_PRIVATE_KEY", desc: "Wallet private key (base58 or JSON array)" },
    { key: "RPC_URL", desc: "Solana RPC URL (e.g. https://api.mainnet-beta.solana.com)" },
    { key: "OPENROUTER_API_KEY", desc: "OpenRouter API key (for AI agent)" },
    { key: "TELEGRAM_BOT_TOKEN", desc: "Telegram bot token (optional)" },
    { key: "TELEGRAM_CHAT_ID", desc: "Telegram chat ID (optional)" },
    { key: "JUPITER_API_KEY", desc: "Jupiter API key (get from https://jupuary.jupiter.money/)" },
    { key: "HELIUS_API_KEY", desc: "Helius API key (for wallet balances)" },
  ];

  const updated: Record<string, string> = { ...existing };
  for (const { key, desc } of vars) {
    const current = existing[key] || "";
    const display = current ? `${current.slice(0, 8)}...` : "(not set)";
    const answer = await question(rl, `${key} (${desc})\n  Current: ${display}\n  New value (Enter to keep): `);
    if (answer.trim()) updated[key] = answer.trim();
    else if (current) updated[key] = current;
  }

  const lines = [
    "# Meridian Environment Configuration",
    `# Generated: ${new Date().toISOString()}`,
    "",
  ];
  for (const { key } of vars) {
    if (updated[key]) lines.push(`${key}=${updated[key]}`);
  }
  lines.push("");

  fs.writeFileSync(ENV_PATH, lines.join("\n"));
  rl.close();

  const saved = vars.map(v => v.key).filter(k => updated[k]);
  return { success: true, message: `Saved to ${ENV_PATH}`, saved };
}
