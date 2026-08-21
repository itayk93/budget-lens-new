import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const MAIN_CASH_FLOW_ID = "c30c2672-2c39-4599-9e4e-0a536591a438";
const MAIN_USER_ID = "e3f6919b-d83b-4456-8325-676550a4382d";
const FLOW_MONTH_HEADER = "שייך לתזרים חודש";

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    out[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^["']|["']$/g, "");
  }
  return out;
}

function cleanHeader(value) {
  return value.replace(/^\uFEFF/, "").trim();
}

function cleanValue(value) {
  const trimmed = (value || "").trim();
  return trimmed === "" || trimmed === "NaN" ? null : trimmed;
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
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [rawHeaders, ...dataRows] = rows;
  const headers = (rawHeaders || []).map(cleanHeader);
  return dataRows
    .filter((dataRow) => dataRow.some((cell) => cleanValue(cell) !== null))
    .map((dataRow) => Object.fromEntries(headers.map((header, i) => [header, dataRow[i] || ""])));
}

function parseDate(value) {
  if (!value) return null;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return value;
  const [, d, m, y] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseNumber(value) {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function stableHash(parts) {
  let hash = 2166136261;
  const text = parts.map((part) => part ?? "").join("|");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `csv_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function mapRows(text) {
  const hashOccurrences = new Map();
  return parseCsv(text).map((row, index) => {
    const flowMonth = cleanValue(row[FLOW_MONTH_HEADER]);
    const paymentDate = parseDate(cleanValue(row["תאריך התשלום"]));
    const chargeDate = parseDate(cleanValue(row["תאריך החיוב בחשבון"]));
    const amount = parseNumber(cleanValue(row["סכום"]));
    if (!flowMonth || !/^\d{4}-\d{2}$/.test(flowMonth)) throw new Error(`Row ${index + 2}: invalid flow_month`);
    if (amount === null) throw new Error(`Row ${index + 2}: invalid amount`);
    const [paymentYear, paymentMonth] = (paymentDate || "").split("-").map(Number);
    const businessName = cleanValue(row["שם העסק"]);
    const paymentMethod = cleanValue(row["אמצעי התשלום"]);
    const paymentIdentifier = cleanValue(row["אמצעי זיהוי התשלום"]);
    const categoryName = cleanValue(row["קטגוריה בתזרים"]);
    const notes = cleanValue(row["הערות"]);
    const sourceType = cleanValue(row["סוג מקור"]);
    const baseTransactionHash = stableHash([
      MAIN_USER_ID,
      MAIN_CASH_FLOW_ID,
      flowMonth,
      paymentDate,
      chargeDate,
      businessName,
      paymentMethod,
      paymentIdentifier,
      amount,
      categoryName,
      notes,
    ]);
    const occurrence = hashOccurrences.get(baseTransactionHash) || 0;
    hashOccurrences.set(baseTransactionHash, occurrence + 1);
    const transactionHash = occurrence === 0 ? baseTransactionHash : `${baseTransactionHash}_${occurrence + 1}`;
    return {
      user_id: MAIN_USER_ID,
      business_name: businessName,
      payment_date: paymentDate,
      amount,
      currency: cleanValue(row["מטבע חיוב"]) || "ILS",
      payment_method: paymentMethod,
      payment_identifier: paymentIdentifier,
      payment_month: Number.isFinite(paymentMonth) ? paymentMonth : null,
      payment_year: Number.isFinite(paymentYear) ? paymentYear : null,
      flow_month: flowMonth,
      charge_date: chargeDate,
      notes,
      excluded_from_flow: (cleanValue(row["האם מוחרג מהתזרים?"]) || "").toLowerCase() === "true",
      source_type: sourceType,
      original_amount: parseNumber(cleanValue(row["סכום מקורי"])),
      transaction_hash: transactionHash,
      cash_flow_id: MAIN_CASH_FLOW_ID,
      category_name: categoryName,
      payment_number: parseNumber(cleanValue(row["מספר התשלום"])),
      total_payments: parseNumber(cleanValue(row["מספר תשלומים כולל"])),
      status: "approved",
      file_source: "csv_import",
    };
  });
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/import-transactions-csv.mjs <csv-path>");
  process.exit(1);
}

const env = parseEnv(await fs.readFile(".env", "utf8"));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rows = mapRows(await fs.readFile(filePath, "utf8"));
const hashes = rows.map((row) => row.transaction_hash);
const { data: existing, error: existingError } = await supabase
  .from("transactions")
  .select("transaction_hash")
  .in("transaction_hash", hashes);
if (existingError) throw existingError;

const existingHashes = new Set((existing || []).map((row) => row.transaction_hash));
const seen = new Set(existingHashes);
const toInsert = rows.filter((row) => {
  if (seen.has(row.transaction_hash)) return false;
  seen.add(row.transaction_hash);
  return true;
});

let inserted = 0;
for (let i = 0; i < toInsert.length; i += 500) {
  const chunk = toInsert.slice(i, i + 500);
  const { data, error } = await supabase.from("transactions").insert(chunk).select("id");
  if (error) throw error;
  inserted += data?.length || 0;
}

console.log(JSON.stringify({
  parsed: rows.length,
  inserted,
  skipped: rows.length - inserted,
  months: [...new Set(rows.map((row) => row.flow_month))].sort(),
}, null, 2));
