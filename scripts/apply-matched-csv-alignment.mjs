import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const MAIN_CASH_FLOW_ID = "c30c2672-2c39-4599-9e4e-0a536591a438";
// Point at your own export:  RISEUP_CSV=/path/to/transactions.csv node <script>
const CSV_PATH = process.env.RISEUP_CSV || process.argv[2] || "";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/u);
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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}

function clean(value) {
  return String(value ?? "").replace(/^\uFEFF/u, "").trim();
}

function parseDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
}

function monthFromDate(value) {
  return String(value || "").slice(0, 7) || null;
}

function normalizeMerchantName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function amountMagnitude(value) {
  return Math.round(Math.abs(Number(value) || 0) * 100);
}

function levenshteinDistance(a, b) {
  const left = [...a];
  const right = [...b];
  const dp = Array.from({ length: left.length + 1 }, () =>
    new Array(right.length + 1).fill(0),
  );
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[left.length][right.length];
}

function similarityRatio(a, b) {
  if (!a && !b) return 100;
  const maxLength = Math.max([...a].length, [...b].length) || 1;
  return Math.round((1 - levenshteinDistance(a, b) / maxLength) * 100);
}

function tokenSetRatio(a, b) {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (!left.size && !right.size) return 100;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return Math.round((intersection / Math.max(left.size, right.size)) * 100);
}

function fuzzyMerchantScore(a, b) {
  return Math.max(similarityRatio(a, b), tokenSetRatio(a, b));
}

function dateDistanceInDays(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(new Date(a) - new Date(b)) / 86400000);
}

function containsMatch(a, b) {
  return a.includes(b) || b.includes(a);
}

function loadCsvRows() {
  const raw = fs.readFileSync(CSV_PATH, "utf8").replace(/^\uFEFF/u, "");
  const parsed = parseCsv(raw);
  const headers = parsed.shift().map(clean);
  return parsed
    .map((values, idx) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])))
    .filter((row) => ["2026-06", "2026-07"].includes(clean(row["שייך לתזרים חודש"])))
    .filter((row) => String(row["האם מוחרג מהתזרים?"]).toLowerCase() !== "true")
    .map((row, idx) => ({
      row_num: idx + 2,
      flow_month: clean(row["שייך לתזרים חודש"]),
      business_name: clean(row["שם העסק"]),
      normalized_business_name: normalizeMerchantName(row["שם העסק"]),
      amount: Number(row["סכום"]),
      amount_magnitude: amountMagnitude(row["סכום"]),
      payment_date: parseDate(row["תאריך התשלום"]),
      charge_date: parseDate(row["תאריך החיוב בחשבון"]),
      category_name: clean(row["קטגוריה בתזרים"]),
      payment_method: clean(row["אמצעי התשלום"]),
    }));
}

async function fetchLocalRows(supabase) {
  const { data, error } = await supabase
    .from("transactions")
    .select("id,bank_scraper_source_id,flow_month,payment_date,charge_date,business_name,amount,category_name,payment_method,file_source,payment_month,payment_year")
    .eq("cash_flow_id", MAIN_CASH_FLOW_ID)
    .eq("status", "approved")
    .eq("excluded_from_flow", false)
    .in("flow_month", ["2026-06", "2026-07"]);
  if (error) throw error;
  return (data || []).map((row) => ({
    ...row,
    normalized_business_name: normalizeMerchantName(row.business_name),
    amount_magnitude: amountMagnitude(row.amount),
  }));
}

function findMatches(localRows, csvRows) {
  const usedCsvIndexes = new Set();
  const updates = [];

  for (const localRow of localRows) {
    let best = null;
    for (let index = 0; index < csvRows.length; index += 1) {
      if (usedCsvIndexes.has(index)) continue;
      const csvRow = csvRows[index];
      const sameMonth = localRow.flow_month === csvRow.flow_month;
      const sameAmount = localRow.amount_magnitude === csvRow.amount_magnitude;
      const nearAmount = Math.abs(localRow.amount_magnitude - csvRow.amount_magnitude) <= 5;
      const score = fuzzyMerchantScore(
        localRow.normalized_business_name,
        csvRow.normalized_business_name,
      );
      const contains = containsMatch(
        localRow.normalized_business_name,
        csvRow.normalized_business_name,
      );
      const dateDistance = Math.min(
        dateDistanceInDays(localRow.payment_date || localRow.charge_date, csvRow.payment_date || csvRow.charge_date),
        30,
      );
      const strong =
        (sameMonth && sameAmount && (score >= 86 || contains)) ||
        (sameMonth && nearAmount && (score >= 96 || contains) && dateDistance <= 3);
      if (!strong) continue;
      const weighted = (sameAmount ? 100 : 95) + (contains ? 8 : 0) + score - dateDistance - Math.abs(localRow.amount_magnitude - csvRow.amount_magnitude);
      if (!best || weighted > best.weighted) {
        best = { index, csvRow, weighted };
      }
    }

    if (!best) continue;
    usedCsvIndexes.add(best.index);
    const csvRow = best.csvRow;
    const patch = {};

    if (localRow.business_name !== csvRow.business_name) patch.business_name = csvRow.business_name;
    if (Math.abs(Number(localRow.amount) - Number(csvRow.amount)) > 0.0001) patch.amount = csvRow.amount;
    if ((localRow.payment_date || null) !== (csvRow.payment_date || null)) patch.payment_date = csvRow.payment_date;
    if ((localRow.charge_date || null) !== (csvRow.charge_date || null)) patch.charge_date = csvRow.charge_date;
    if ((localRow.flow_month || null) !== (csvRow.flow_month || null)) patch.flow_month = csvRow.flow_month;
    if ((localRow.payment_method || "") !== (csvRow.payment_method || "")) patch.payment_method = csvRow.payment_method;

    if (patch.payment_date) {
      patch.payment_month = Number(String(patch.payment_date).slice(5, 7));
      patch.payment_year = Number(String(patch.payment_date).slice(0, 4));
      if (!patch.flow_month) patch.flow_month = monthFromDate(patch.payment_date);
    }

    if (Object.keys(patch).length) {
      updates.push({
        id: localRow.id,
        bank_scraper_source_id: localRow.bank_scraper_source_id,
        csv_row: csvRow.row_num,
        patch,
      });
    }
  }

  return updates;
}

async function applyUpdates(supabase, updates) {
  const applied = [];
  for (const update of updates) {
    const { error } = await supabase.from("transactions").update(update.patch).eq("id", update.id);
    if (error) throw error;

    if (update.bank_scraper_source_id) {
      const sourcePatch = {};
      if (update.patch.business_name) sourcePatch.description = update.patch.business_name;
      if (update.patch.payment_date) sourcePatch.transaction_date = update.patch.payment_date;
      if (update.patch.charge_date) sourcePatch.processed_date = update.patch.charge_date;
      if (Object.keys(sourcePatch).length) {
        const { error: sourceError } = await supabase
          .from("bank_scraper_transactions")
          .update(sourcePatch)
          .eq("id", update.bank_scraper_source_id);
        if (sourceError) throw sourceError;
      }
    }

    applied.push(update);
  }
  return applied;
}

async function main() {
  loadEnv();
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const csvRows = loadCsvRows();
  const localRows = await fetchLocalRows(supabase);
  const updates = findMatches(localRows, csvRows);
  const applied = await applyUpdates(supabase, updates);

  console.log(JSON.stringify({
    updated: applied.length,
    rows: applied.map((row) => ({ id: row.id, bank_scraper_source_id: row.bank_scraper_source_id, csv_row: row.csv_row, patch: row.patch })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
