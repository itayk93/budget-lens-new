import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const MAIN_USER_ID = "e3f6919b-d83b-4456-8325-676550a4382d";
const MAIN_CASH_FLOW_ID = "c30c2672-2c39-4599-9e4e-0a536591a438";
const DEFAULT_CATEGORY = "אחר";

const MAX_CATEGORY_FALLBACKS = new Map([
  ["מסעדות, קפה וברים", "אוכל בחוץ"],
  ["דלק, חשמל וגז", "הוצאות משתנות"],
  ["טיסות ותיירות", "טיול ביפן 🇯🇵"],
]);

function parseCliArgs(argv) {
  return {
    sendEmail: argv.includes("--send-email"),
    dryRun: argv.includes("--dry-run"),
  };
}

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
  const repoRoot = process.cwd();
  loadEnvFile(path.join(repoRoot, ".env.supabase.local"));
  loadEnvFile(path.join(repoRoot, ".env.local"));
  loadEnvFile(path.join(repoRoot, ".env"));
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function normalizeMerchantName(input) {
  const base = String(input || "")
    .normalize("NFKC")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[._*\/\\-]+/g, " ")
    .replace(/\b(?:אינטרנט|אשראי|חיוב|קניה|עסקה|תשלום|ONLINE|INTERNET|PURCHASE|WWW|COM|CO|IL)\b/giu, " ")
    .replace(/\d{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  return base.length >= 2 ? base : String(input || "").trim().toUpperCase();
}

function tokenizeNormalizedMerchant(input) {
  return normalizeMerchantName(input)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function levenshteinDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[left.length][right.length];
}

function similarityRatio(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!left && !right) return 100;
  const maxLength = Math.max(left.length, right.length);
  if (!maxLength) return 100;
  return Math.round((1 - levenshteinDistance(left, right) / maxLength) * 100);
}

function tokenSetRatio(a, b) {
  const leftTokens = Array.from(new Set(tokenizeNormalizedMerchant(a)));
  const rightTokens = Array.from(new Set(tokenizeNormalizedMerchant(b)));
  if (!leftTokens.length || !rightTokens.length) return 0;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token));
  const leftDiff = leftTokens.filter((token) => !rightSet.has(token));
  const rightDiff = rightTokens.filter((token) => !leftSet.has(token));

  const intersectionText = intersection.join(" ").trim();
  const leftCombined = [intersectionText, ...leftDiff].filter(Boolean).join(" ").trim();
  const rightCombined = [intersectionText, ...rightDiff].filter(Boolean).join(" ").trim();
  const overlapScore = Math.round((2 * intersection.length / (leftTokens.length + rightTokens.length)) * 100);

  return Math.max(
    overlapScore,
    similarityRatio(leftCombined, rightCombined),
    similarityRatio(intersectionText, leftCombined),
    similarityRatio(intersectionText, rightCombined),
    similarityRatio(leftTokens.join(" "), rightTokens.join(" "))
  );
}

function fuzzyMerchantScore(a, b) {
  return Math.max(similarityRatio(normalizeMerchantName(a), normalizeMerchantName(b)), tokenSetRatio(a, b));
}

function dateDistanceInDays(left, right) {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) / (24 * 60 * 60 * 1000);
}

function sha1(value) {
  return createHash("sha1").update(value).digest("hex");
}

function chunk(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function monthFromDate(dateString) {
  return String(dateString || "").slice(0, 7);
}

async function readStdin() {
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

function parseAmount(input) {
  const text = String(input ?? "").replace(/[^\d.-]/g, "");
  const value = Number(text);
  return Number.isFinite(value) ? value : 0;
}

function normalizeInputTransaction(tx) {
  return {
    business_name: String(tx.business_name || "").trim(),
    payment_date: String(tx.payment_date || "").trim(),
    charge_date: String(tx.charge_date || tx.payment_date || "").trim(),
    amount: Number(tx.amount),
    source_category: String(tx.source_category || "").trim(),
    card_suffix: String(tx.card_suffix || "4514").trim(),
  };
}

async function loadApprovedTransactions(supabase) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const to = from + 999;
    const { data, error } = await supabase
      .from("transactions")
      .select("id,business_name,payment_date,charge_date,amount,category_name,payment_method,status,user_id")
      .eq("user_id", MAIN_USER_ID)
      .eq("status", "approved")
      .range(from, to);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function buildCategoryDecision(tx, approved) {
  const exact = approved.find((row) => (
    normalizeMerchantName(row.business_name) === normalizeMerchantName(tx.business_name)
    && row.category_name
  ));
  if (exact) {
    return {
      categoryName: exact.category_name,
      source: "transactions",
      notes: "[AUTO:transactions] Matched against existing approved transactions",
    };
  }

  const fuzzy = approved
    .map((row) => ({ row, score: fuzzyMerchantScore(row.business_name, tx.business_name) }))
    .filter((entry) => entry.row.category_name && entry.score >= 88)
    .sort((left, right) => right.score - left.score)[0];

  if (fuzzy) {
    return {
      categoryName: fuzzy.row.category_name,
      source: "transactions_fuzzy",
      notes: `[AUTO:transactions_fuzzy] Fuzzy matched approved transactions (${fuzzy.row.business_name}) with score ${fuzzy.score}`,
    };
  }

  return {
    categoryName: MAX_CATEGORY_FALLBACKS.get(tx.source_category) || DEFAULT_CATEGORY,
    source: "max_page_fallback",
    notes: `[AUTO:max_page_fallback] Imported from logged-in Max page category ${tx.source_category || "unknown"}`,
  };
}

function isDuplicateMaxTransaction(tx, approved) {
  return approved.find((row) => (
    row.payment_method === "max"
    && Math.abs(Number(row.amount) - tx.amount) <= 0.01
    && dateDistanceInDays(row.payment_date, tx.payment_date) <= 1
    && fuzzyMerchantScore(row.business_name, tx.business_name) >= 90
  )) || null;
}

function buildInsertRow(tx, decision) {
  return {
    user_id: MAIN_USER_ID,
    business_name: tx.business_name,
    payment_date: tx.payment_date,
    charge_date: tx.charge_date,
    amount: tx.amount,
    currency: "ILS",
    payment_method: "max",
    payment_identifier: `max_manual|${tx.payment_date}|${tx.business_name}|${Math.abs(tx.amount).toFixed(2)}`,
    payment_month: Number(tx.payment_date.slice(5, 7)),
    payment_year: Number(tx.payment_date.slice(0, 4)),
    flow_month: monthFromDate(tx.payment_date),
    notes: decision.notes,
    excluded_from_flow: false,
    source_type: "bank_scraper",
    original_amount: tx.amount,
    transaction_hash: sha1(`max_manual|${tx.payment_date}|${tx.charge_date}|${tx.business_name}|${tx.amount}`),
    is_transfer: false,
    original_currency: "ILS",
    source_category: tx.source_category || null,
    transaction_type: "normal",
    file_source: "max",
    cash_flow_id: MAIN_CASH_FLOW_ID,
    category_name: decision.categoryName,
    status: "approved",
  };
}

function parseRecipientList(value) {
  return Array.from(new Set(
    String(value || "")
      .split(/[,\n;]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  ));
}

function resolveReportRecipients() {
  const explicit = parseRecipientList(process.env.BANK_SCRAPER_REPORT_EMAIL || process.env.BANK_SCRAPER_REPORT_EMAILS);
  if (explicit.length > 0) return explicit;
  return parseRecipientList(process.env.LEAD_NOTIFICATION_EMAIL);
}

async function sendBrevoEmail(insertedRows) {
  const apiKey = process.env.BREVO_API_KEY;
  const recipients = resolveReportRecipients();
  const senderEmail = process.env.BREVO_SENDER_EMAIL || recipients[0] || "";
  if (!apiKey || !senderEmail || recipients.length === 0) {
    return { status: "skipped", reason: "Brevo not configured" };
  }

  const items = insertedRows.map((row) => (
    `<li>${row.payment_date} · ${row.business_name} · ${row.amount} · ${row.category_name}</li>`
  )).join("");

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || "Budget Lens",
        email: senderEmail,
      },
      to: recipients.map((email) => ({ email })),
      subject: `Max fallback import · 03/08/2026 · ${insertedRows.length} rows`,
      htmlContent: `<div dir="rtl"><h2>Max fallback import</h2><p>Imported ${insertedRows.length} rows from logged-in Max page.</p><ul>${items}</ul></div>`,
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) throw new Error(`Brevo email failed (${response.status})`);
  return { status: "sent", recipientCount: recipients.length };
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  loadEnv();
  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SECRET"), {
    auth: { persistSession: false },
  });

  const rawInput = (await readStdin()).trim();
  const parsed = rawInput ? JSON.parse(rawInput) : {};
  const txs = Array.isArray(parsed.transactions) ? parsed.transactions.map(normalizeInputTransaction) : [];
  if (txs.length === 0) throw new Error("No transactions provided");

  const approved = await loadApprovedTransactions(supabase);
  const results = [];
  const toInsert = [];

  for (const tx of txs) {
    const duplicate = isDuplicateMaxTransaction(tx, approved);
    if (duplicate) {
      results.push({
        business_name: tx.business_name,
        action: "skipped_duplicate",
        matched_id: duplicate.id,
      });
      continue;
    }

    const decision = buildCategoryDecision(tx, approved);
    const row = buildInsertRow(tx, decision);
    toInsert.push(row);
    approved.push({
      id: row.transaction_hash,
      business_name: row.business_name,
      payment_date: row.payment_date,
      charge_date: row.charge_date,
      amount: row.amount,
      category_name: row.category_name,
      payment_method: row.payment_method,
      status: row.status,
      user_id: row.user_id,
    });
    results.push({
      business_name: tx.business_name,
      action: cli.dryRun ? "would_insert" : "insert",
      category_name: row.category_name,
      category_source: decision.source,
    });
  }

  let inserted = [];
  if (!cli.dryRun && toInsert.length > 0) {
    for (const rowsChunk of chunk(toInsert, 200)) {
      const { data, error } = await supabase
        .from("transactions")
        .insert(rowsChunk)
        .select("id,business_name,payment_date,charge_date,amount,category_name");
      if (error) throw error;
      inserted.push(...(data || []));
    }
  } else {
    inserted = toInsert.map((row) => ({
      id: row.transaction_hash,
      business_name: row.business_name,
      payment_date: row.payment_date,
      charge_date: row.charge_date,
      amount: row.amount,
      category_name: row.category_name,
    }));
  }

  const email = cli.sendEmail && inserted.length > 0 && !cli.dryRun
    ? await sendBrevoEmail(inserted)
    : { status: "skipped", reason: cli.sendEmail ? "no rows" : "flag not set" };

  process.stdout.write(JSON.stringify({
    dryRun: cli.dryRun,
    inserted_count: inserted.length,
    inserted,
    results,
    email,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
