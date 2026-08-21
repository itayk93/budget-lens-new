import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_MONTHS = ["2026-06", "2026-07"];
const DEFAULT_OUTPUT = "/tmp/riseup_category_mismatches.json";
// Point at your own export:  RISEUP_CSV=/path/to/transactions.csv node <script>
const DEFAULT_CSV = process.env.RISEUP_CSV || process.argv[2] || "";
const MAIN_CASH_FLOW_ID = "c30c2672-2c39-4599-9e4e-0a536591a438";

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

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
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
  const maxLength = Math.max([...a].length, [...b].length);
  if (!maxLength) return 100;
  return Math.round((1 - levenshteinDistance(a, b) / maxLength) * 100);
}

function tokenSetRatio(a, b) {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (!left.size && !right.size) return 100;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const denominator = Math.max(left.size, right.size);
  return Math.round((intersection / denominator) * 100);
}

function fuzzyMerchantScore(a, b) {
  return Math.max(similarityRatio(a, b), tokenSetRatio(a, b));
}

function dateDistanceInDays(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const left = new Date(a);
  const right = new Date(b);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round(Math.abs(left.getTime() - right.getTime()) / 86400000);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}

function parseRiseupDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/u);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function loadRiseupCsvEntries(csvPath, months) {
  const csvRows = parseCsv(fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF+/u, ""));
  const headers = (csvRows.shift() || []).map((header) => header.replace(/^\uFEFF+/u, "").trim());
  const monthSet = new Set(months);

  return csvRows.flatMap((values, rowIndex) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const flowMonth = row["שייך לתזרים חודש"];
    if (!monthSet.has(flowMonth)) return [];
    if (String(row["האם מוחרג מהתזרים?"]).toLowerCase() === "true") return [];
    const amount = Number(row["סכום"]);
    if (!row["שם העסק"] || !row["קטגוריה בתזרים"] || !Number.isFinite(amount)) return [];
    return [{
      transactionId: `csv-${rowIndex + 2}`,
      cashflowDate: flowMonth,
      businessName: row["שם העסק"],
      amount,
      categoryLabel: row["קטגוריה בתזרים"],
      transactionDate: parseRiseupDate(row["תאריך התשלום"]),
      billingDate: parseRiseupDate(row["תאריך החיוב בחשבון"]),
      sourceType: row["סוג מקור"] || null,
      paymentMethod: row["אמצעי התשלום"] || null,
      csvRowNumber: rowIndex + 2,
    }];
  });
}

async function fetchLocalTransactions(months) {
  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SECRET"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("transactions")
    .select("id, flow_month, payment_date, charge_date, business_name, amount, category_name, status, excluded_from_flow, cash_flow_id")
    .eq("cash_flow_id", MAIN_CASH_FLOW_ID)
    .eq("status", "approved")
    .eq("excluded_from_flow", false)
    .in("flow_month", months)
    .order("payment_date", { ascending: true })
    .order("charge_date", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

function buildMismatchRows(localRows, riseupEntries) {
  const riseupCandidates = riseupEntries
    .map((entry) => ({
      ...entry,
      flow_month: entry.cashflowDate,
      business_name: entry.businessName,
      amount_magnitude: amountMagnitude(entry.amount),
      normalized_business_name: normalizeMerchantName(entry.businessName),
      riseup_flow_category: entry.categoryLabel || null,
      match_date: String(entry.transactionDate || "").slice(0, 10),
    }))
    .filter((entry) => entry.flow_month && entry.business_name && entry.riseup_flow_category);

  return localRows.flatMap((row) => {
    const normalizedBusinessName = normalizeMerchantName(row.business_name);
    const amountMagnitudeValue = amountMagnitude(row.amount);
    const rowDate = row.payment_date || row.charge_date;
    const sameMonth = riseupCandidates.filter(
      (entry) =>
        entry.flow_month === row.flow_month &&
        entry.amount_magnitude === amountMagnitudeValue,
    );

    let best = null;
    for (const entry of sameMonth) {
      if (entry.normalized_business_name !== normalizedBusinessName) continue;
      const score = 100;
      const dateDistance = dateDistanceInDays(rowDate, entry.match_date);
      if (
        !best ||
        score > best.match_score ||
        (score === best.match_score && dateDistance < best.date_distance)
      ) {
        best = {
          entry,
          match_type: "exact",
          match_score: score,
          date_distance: dateDistance,
        };
      }
    }

    if (!best) {
      for (const entry of sameMonth) {
        const score = fuzzyMerchantScore(normalizedBusinessName, entry.normalized_business_name);
        if (score < 86) continue;
        const dateDistance = dateDistanceInDays(rowDate, entry.match_date);
        const weightedScore = score - Math.min(dateDistance, 30);
        if (
          !best ||
          weightedScore > best.weighted_score ||
          (weightedScore === best.weighted_score && dateDistance < best.date_distance)
        ) {
          best = {
            entry,
            match_type: "fuzzy",
            match_score: score,
            weighted_score: weightedScore,
            date_distance: dateDistance,
          };
        }
      }
    }

    if (!best) return [];

    const riseupCategory = best.entry.riseup_flow_category;
    if (!riseupCategory || riseupCategory === row.category_name) return [];

    return [{
      id: row.id,
      flow_month: row.flow_month,
      payment_date: row.payment_date,
      charge_date: row.charge_date,
      business_name: row.business_name,
      amount: row.amount,
      local_category: row.category_name,
      riseup_category: riseupCategory,
      riseup_category_source: "csv_flow_category",
      match_type: best.match_type,
      match_score: best.match_score,
      matched_business_name: best.entry.business_name,
      matched_date: best.entry.match_date,
      riseup_transaction_id: best.entry.transactionId,
      riseup_source_type: best.entry.sourceType,
      riseup_category_type: best.entry.categoryType ?? null,
    }];
  });
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const csvPath = args.find((value) => value.toLowerCase().endsWith(".csv")) || DEFAULT_CSV;
  const requestedMonths = args.filter((value) => /^\d{4}-\d{2}$/.test(value));
  const months = requestedMonths.length ? requestedMonths : DEFAULT_MONTHS;

  const localRows = await fetchLocalTransactions(months);
  const riseupEntries = loadRiseupCsvEntries(csvPath, months);
  const mismatches = buildMismatchRows(localRows, riseupEntries);

  fs.writeFileSync(DEFAULT_OUTPUT, JSON.stringify(mismatches, null, 2));
  process.stdout.write(
    JSON.stringify({
      output: DEFAULT_OUTPUT,
      csv: csvPath,
      months,
      local_rows: localRows.length,
      riseup_entries: riseupEntries.length,
      mismatches: mismatches.length,
      riseup_category_source: "csv_flow_category",
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
