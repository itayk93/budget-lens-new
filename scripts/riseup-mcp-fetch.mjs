import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    const unquoted = rawValue.replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = unquoted;
  }
}

function loadEnv() {
  loadEnvFile(path.join(repoRoot, ".env.supabase.local"));
  loadEnvFile(path.join(repoRoot, ".env.local"));
  loadEnvFile(path.join(repoRoot, ".env"));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function main() {
  loadEnv();

  const rawInput = (await readStdin()).trim();
  const payload = rawInput ? JSON.parse(rawInput) : {};
  const monthKeys = unique(Array.isArray(payload.monthKeys) ? payload.monthKeys : []);
  const tool = payload.tool === "transactions" ? "transactions" : "budget";

  if (!monthKeys.length) {
    process.stdout.write(JSON.stringify({ entries: [] }));
    return;
  }

  const clientCode = `
    import { Client } from "@modelcontextprotocol/sdk/client/index.js";
    import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

    const input = JSON.parse(process.env.RISEUP_FETCH_INPUT || "{}");
    const months = Array.from(new Set(Array.isArray(input.monthKeys) ? input.monthKeys.filter(Boolean) : []));
    const tool = input.tool === "transactions" ? "transactions" : "budget";
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["-y", "@riseup-oss/mcp"],
      env: { ...process.env },
    });
    const client = new Client({ name: "budget-lens-riseup-fetch", version: "1.0.0" });

    try {
      await client.connect(transport);
      const entries = [];
      for (const month of months) {
        const result = await client.callTool({
          name: tool === "transactions" ? "get_transactions" : "get_budget",
          arguments: tool === "transactions" ? { cashflowMonth: month } : { date: month },
        });
        const textParts = Array.isArray(result?.content)
          ? result.content.filter((part) => part?.type === "text").map((part) => part.text)
          : [];
        const parsed = JSON.parse(textParts.join("\\n") || "{}");
        if (tool === "transactions") {
          const transactions = Array.isArray(parsed?.transactions) ? parsed.transactions : [];
          for (const transaction of transactions) {
            entries.push({ ...transaction, source: "riseup_mcp_live" });
          }
          continue;
        }
        const envelopes = Array.isArray(parsed?.envelopes) ? parsed.envelopes : [];
        const excluded = Array.isArray(parsed?.excluded) ? parsed.excluded : [];
        for (const envelope of envelopes) {
          const actuals = Array.isArray(envelope?.actuals) ? envelope.actuals : [];
          for (const actual of actuals) {
            entries.push({
              ...actual,
              riseupEnvelope: Object.fromEntries(
                Object.entries(envelope).filter(([key]) => key !== "actuals"),
              ),
              source: "riseup_mcp_live",
            });
          }
        }
        for (const actual of excluded) {
          entries.push({ ...actual, source: "riseup_mcp_live", excluded: true });
        }
      }
      process.stdout.write(JSON.stringify({ entries }));
    } finally {
      await client.close().catch(() => {});
    }
  `;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "riseup-mcp-fetch-"));
  fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({
    private: true,
    type: "module",
  }));
  fs.writeFileSync(path.join(tempDir, "client.mjs"), clientCode);

  const install = spawnSync(
    "npm",
    ["install", "--silent", "@modelcontextprotocol/sdk", "@riseup-oss/mcp"],
    {
      cwd: tempDir,
      encoding: "utf8",
      env: process.env,
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  if (install.error) throw install.error;
  if (install.status !== 0) {
    const errorText = (install.stderr || install.stdout || `exit ${install.status}`).trim();
    throw new Error(`RiseUp MCP helper install failed: ${errorText}`);
  }

  const result = spawnSync(
    "node",
    [
      path.join(tempDir, "client.mjs"),
    ],
    {
      cwd: tempDir,
      encoding: "utf8",
      env: {
        ...process.env,
        RISEUP_FETCH_INPUT: JSON.stringify({ monthKeys, tool }),
      },
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const errorText = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`RiseUp MCP helper failed: ${errorText}`);
  }

  process.stdout.write(result.stdout || JSON.stringify({ entries: [] }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
