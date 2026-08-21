import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { CompanyTypes, createScraper } = require(path.join(repoRoot, "israeli-bank-scrapers", "lib", "index.js"));

const MAIN_USER_ID = "e3f6919b-d83b-4456-8325-676550a4382d";
const MAIN_CASH_FLOW_ID = "c30c2672-2c39-4599-9e4e-0a536591a438";
const START_LOOKBACK_DAYS = 60;
const DEFAULT_CATEGORY = "אחר";
const DEFERRED_REVIEW_TAG = "[REVIEW_REQUIRED:CODEX]";
const FUZZY_MATCH_THRESHOLD = 86;
const MAX_PERPLEXITY_CITATIONS = 2;
const REPORT_TIMEZONE = "Asia/Jerusalem";
const PROVIDER_SCRAPE_TIMEOUT_MS = 5 * 60 * 1000;
const VARIABLE_INCOME_CATEGORY = "הכנסות משתנות";
const FIXED_INCOME_CATEGORY = "הכנסות לא משתנות";
const INCOME_CATEGORY_CANDIDATES = [VARIABLE_INCOME_CATEGORY, FIXED_INCOME_CATEGORY];
const PROVIDER_RETRY_ATTEMPTS = {
  amex: 3,
  max: 3,
};
const PROVIDER_RETRY_DELAY_MS = 2500;
const CARD_SETTLEMENT_ISSUER_MERCHANTS = new Set([
  'ישראכרט בע"מ',
  'ישראכרט בע"מ',
  'מקס איט פיננסים',
]);
const CARD_ISSUER_MERCHANTS = new Set([
  'פרימיום אקספרס',
  'דיינרס קלוב ישר',
  'כרטיסי אשראי לי',
  'מקס איט פיננסים',
]);

function parseCliArgs(argv) {
  const out = {
    deferClassification: false,
    dryRun: false,
    helperProvider: null,
    helperStartDate: null,
    limit: null,
    providers: null,
  };

  for (const arg of argv) {
    if (arg === "--defer-classification") out.deferClassification = true;
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg.startsWith("--scrape-provider-helper=")) out.helperProvider = arg.split("=")[1] || null;
    else if (arg.startsWith("--start-date=")) out.helperStartDate = arg.split("=")[1] || null;
    else if (arg.startsWith("--limit=")) out.limit = Number(arg.split("=")[1] || "");
    else if (arg.startsWith("--providers=")) {
      out.providers = arg
        .split("=")[1]
        ?.split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean) || null;
    }
  }

  return out;
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
  loadEnvFile(path.join(repoRoot, ".env.supabase.local"));
  loadEnvFile(path.join(repoRoot, ".env.local"));
  loadEnvFile(path.join(repoRoot, ".env"));
}

function envFlagEnabled(name) {
  return /^(1|true|yes|on)$/iu.test(String(process.env[name] || "").trim());
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

function canonicalizeMerchantName(input) {
  return String(input || "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokenizeNormalizedMerchant(input) {
  return normalizeMerchantName(input)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function sha1(value) {
  return createHash("sha1").update(value).digest("hex");
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

function chunk(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryProviderError(providerKey, error) {
  const message = formatError(error).toLowerCase();
  if (providerKey === "amex") {
    if (message.includes("invalid_password")) return false;
    if (message.includes("unknown error during login")) return false;
    if (message.includes("login")) return false;
    if (message.includes("תעודת")) return false;
  }

  if (message.includes("timed out")) return true;
  return providerKey === "max";
}

function monthFromDate(dateString) {
  if (!dateString) return null;
  return String(dateString).slice(0, 7);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function roundAbsAmount(value) {
  return Number(Math.abs(Number(value) || 0).toFixed(2));
}

function buildTransactionRepresentationKey({
  businessName,
  paymentDate,
  chargeDate,
  amount,
  paymentMethod,
}) {
  return [
    normalizeMerchantName(businessName),
    paymentDate || "",
    chargeDate || "",
    roundAbsAmount(amount).toFixed(2),
    paymentMethod || "",
  ].join("|");
}

function buildLooseTransactionRepresentationKey({
  businessName,
  paymentDate,
  amount,
  paymentMethod,
}) {
  return [
    normalizeMerchantName(businessName),
    paymentDate || "",
    roundAbsAmount(amount).toFixed(2),
    paymentMethod || "",
  ].join("|");
}

function buildPendingCompletionMatchKey({
  configId,
  businessName,
  paymentDate,
  amount,
  paymentMethod,
}) {
  return [
    configId || "",
    normalizeMerchantName(businessName),
    paymentDate || "",
    roundAbsAmount(amount).toFixed(2),
    paymentMethod || "",
  ].join("|");
}

function buildPendingLifecycleIdentityKey({
  configId,
  businessName,
  paymentDate,
  paymentMethod,
  paymentNumber,
  totalPayments,
  transactionType,
}) {
  return [
    configId || "",
    normalizeMerchantName(businessName),
    paymentDate || "",
    paymentMethod || "",
    paymentNumber ?? "",
    totalPayments ?? "",
    transactionType || "",
  ].join("|");
}

function parseDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function fallbackTransactionIdentifier(accountNumber, txn) {
  return sha1([
    accountNumber || "",
    txn.date || "",
    txn.processedDate || "",
    txn.originalAmount ?? "",
    txn.chargedAmount ?? "",
    txn.description || "",
    txn.memo || "",
    txn.installments?.number ?? "",
    txn.installments?.total ?? "",
  ].join("|"));
}

function isNotInFlow(categoryName) {
  return categoryName.includes("לא תזרימי");
}

async function paginateSelect(selectPage) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await selectPage(from, to);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function log(message, payload) {
  if (payload === undefined) console.log(message);
  else console.log(message, payload);
}

function isMissingRelationError(error) {
  return error && typeof error === "object" && error.code === "42P01";
}

function sanitizeLogText(value) {
  let text = String(value ?? "");
  if (!text) return text;

  text = text.replace(
    /("?(?:password|secret|token|api[_-]?key|authorization|nationalID|cardSuffix|card6Digits)"?\s*:\s*")([^"]*)"/giu,
    '$1[REDACTED]"'
  );
  text = text.replace(/("id"\s*:\s*")(\d{5,})"/giu, '$1[REDACTED]"');
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, "[REDACTED_IP]");

  if (/<(?:!DOCTYPE|html|head|body)\b/iu.test(text)) {
    text = text.replace(/result:\s*<!DOCTYPE[\s\S]*/iu, "result: [HTML response omitted]");
    text = text.replace(/<!DOCTYPE[\s\S]*/iu, "[HTML response omitted]");
  }

  text = text.replace(/\s+/gu, " ").trim();
  if (text.length > 700) {
    text = `${text.slice(0, 697)}...`;
  }
  return text;
}

function formatError(error) {
  if (error instanceof Error) return sanitizeLogText(`${error.name}: ${error.message}`);
  try {
    if (error && typeof error === "object") {
      return sanitizeLogText(JSON.stringify(Object.fromEntries(
        Object.getOwnPropertyNames(error).map((key) => [key, error[key]])
      )));
    }
    return sanitizeLogText(JSON.stringify(error));
  } catch {
    return sanitizeLogText(String(error));
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeZone: REPORT_TIMEZONE,
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: REPORT_TIMEZONE,
  }).format(new Date(value));
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

function buildRunSummary({ dryRun, runStats, runDetails, notificationEmail = null }) {
  return {
    dryRun,
    providers_run: runDetails.map((detail) => detail.provider),
    counts: {
      scraped: runStats.total_scraped,
      new_source_rows: runStats.total_new_sources,
      new_approved_transactions: runStats.total_new_transactions,
      deferred_pending_rows: runStats.total_new_pending,
      duplicate_rows_prevented: runStats.total_duplicates_prevented,
      classified_from_memory: runStats.total_classified_from_memory,
      classified_from_ai: runStats.total_classified_from_ai,
      failed_providers: runStats.total_failed_providers,
    },
    provider_results: runDetails.map((detail) => ({
      provider: detail.provider,
      status: detail.status,
      scraped: detail.scraped,
      new_source_rows: detail.newSources,
      new_approved_transactions: detail.newTransactions,
      deferred_pending_rows: detail.newPending,
      duplicate_rows_prevented: detail.duplicatesPrevented,
    })),
    failures: runDetails
      .filter((detail) => detail.status === "failed")
      .map((detail) => ({
        provider: detail.provider,
        errors: detail.errors.map((message) => sanitizeLogText(message)),
      })),
    notification_email: notificationEmail,
  };
}

function amountDirection(amount) {
  return Number(amount) >= 0 ? "credit" : "debit";
}

function isIncomeCategory(categoryName) {
  return INCOME_CATEGORY_CANDIDATES.includes(String(categoryName || "").trim());
}

function isCardSettlementCharge({ provider, txn }) {
  if (!provider || provider.key !== "yahav") return false;
  const merchant = canonicalizeMerchantName(txn?.description || "");
  return CARD_SETTLEMENT_ISSUER_MERCHANTS.has(merchant);
}

function isCardIssuerStatementLike({ provider, txn }) {
  if (!provider || provider.key !== "yahav") return false;
  const merchant = canonicalizeMerchantName(txn?.description || "");
  return CARD_ISSUER_MERCHANTS.has(merchant);
}

function incomeKeywordCategory(merchantName, sourceCategory, allowedCategorySet) {
  const text = `${merchantName || ""} ${sourceCategory || ""}`.toLowerCase();
  const fixedIncomeHints = [
    "משכורת",
    "salary",
    "payroll",
    "שכר",
    "פנסיה",
    "קצבה",
    "bituach leumi",
    "ביטוח לאומי",
  ];

  if (fixedIncomeHints.some((hint) => text.includes(hint.toLowerCase())) && allowedCategorySet.has(FIXED_INCOME_CATEGORY)) {
    return FIXED_INCOME_CATEGORY;
  }

  if (allowedCategorySet.has(VARIABLE_INCOME_CATEGORY)) return VARIABLE_INCOME_CATEGORY;
  if (allowedCategorySet.has(FIXED_INCOME_CATEGORY)) return FIXED_INCOME_CATEGORY;
  return DEFAULT_CATEGORY;
}

function recencyScore(value) {
  const date = parseDate(value);
  if (!date) return 0;
  const daysAgo = Math.max(0, (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, 30 - Math.min(daysAgo, 30));
}

function amountMagnitude(value) {
  return roundAbsAmount(value);
}

function resolveScrapedAmount(txn) {
  const charged = Number(txn?.chargedAmount);
  const original = Number(txn?.originalAmount);
  if (Number.isFinite(charged) && Math.abs(charged) > 0.000001) return charged;
  if (Number.isFinite(original) && Math.abs(original) > 0.000001) return original;
  if (Number.isFinite(charged)) return charged;
  if (Number.isFinite(original)) return original;
  return 0;
}

function resolveStoredAmount(row) {
  const amount = Number(row?.amount);
  const original = Number(row?.original_amount);
  if (Number.isFinite(amount) && Math.abs(amount) > 0.000001) return amount;
  if (Number.isFinite(original) && Math.abs(original) > 0.000001) return original;
  if (Number.isFinite(amount)) return amount;
  if (Number.isFinite(original)) return original;
  return 0;
}

function isOlderThanDays(value, days) {
  const date = parseDate(value);
  if (!date) return false;
  return (Date.now() - date.getTime()) >= days * 24 * 60 * 60 * 1000;
}

function dateDistanceInDays(left, right) {
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);
  if (!leftDate || !rightDate) return 999;
  return Math.abs(leftDate.getTime() - rightDate.getTime()) / (24 * 60 * 60 * 1000);
}

function buildEmailSubject({ runStats, partialFailure, runStartedAt }) {
  const dateLabel = new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeZone: REPORT_TIMEZONE,
  }).format(runStartedAt || new Date());
  const statusLabel = partialFailure ? "חלקי" : "הושלם";
  return `סיכום סריקת בנקים ${statusLabel} · ${dateLabel} · ${runStats.total_new_transactions} רשומות חדשות`;
}

function buildBankScraperReportEmailHtml({ runStats, runDetails, partialFailure, reportTransactions, runStartedAt }) {
  const failures = runDetails.filter((detail) => detail.status === "failed");
  const rowsHtml = reportTransactions.length > 0
    ? reportTransactions.map((transaction) => {
        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #eee8dd;white-space:nowrap">${escapeHtml(formatDate(transaction.payment_date))}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee8dd">${escapeHtml(transaction.business_name)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee8dd;white-space:nowrap">${escapeHtml(transaction.file_source || transaction.provider || "—")}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee8dd;white-space:nowrap;direction:ltr;text-align:left">${escapeHtml(formatCurrency(transaction.amount))}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee8dd">${escapeHtml(transaction.category_name || "—")}</td>
          </tr>`;
      }).join("")
    : `
      <tr>
        <td colspan="5" style="padding:18px 12px;text-align:center;color:#687064">לא נוספו היום רשומות חדשות.</td>
      </tr>`;

  const providerRows = runDetails.map((detail) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee8dd">${escapeHtml(detail.provider)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee8dd">${escapeHtml(detail.status)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee8dd">${detail.scraped}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee8dd">${detail.newSources}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee8dd">${detail.newTransactions}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee8dd">${detail.newPending}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee8dd">${detail.duplicatesPrevented}</td>
    </tr>
  `).join("");

  const failuresHtml = failures.length > 0
    ? `
      <div style="margin-top:20px;padding:16px;background:#fff6f3;border:1px solid #ffd4c7;border-radius:10px">
        <div style="font-size:16px;font-weight:800;color:#8a2b14;margin-bottom:8px">כשלים חלקיים</div>
        ${failures.map((detail) => `
          <div style="margin-top:8px;color:#5b3024">
            <strong>${escapeHtml(detail.provider)}:</strong> ${escapeHtml(detail.errors.join(" | "))}
          </div>
        `).join("")}
      </div>`
    : "";

  return `
    <div dir="rtl" style="margin:0;background:#f5f4ef;padding:24px 12px;font-family:Arial,'Helvetica Neue',sans-serif;color:#171714">
      <div style="max-width:1040px;margin:0 auto;background:#ffffff;border:1px solid #e5e0d6;border-radius:12px;overflow:hidden">
        <div style="padding:24px 24px 14px;border-bottom:1px solid #eee8dd;background:#faf8f3">
          <div style="margin:0 0 8px;color:#687064;font-size:13px;font-weight:700;letter-spacing:.2px">סיכום יומי אחרי ריצת bank scrape</div>
          <h1 style="margin:0;color:#171714;font-size:28px;line-height:1.25;font-weight:800">
            ${partialFailure ? "הריצה הושלמה חלקית" : "הריצה הושלמה"}
          </h1>
          <div style="margin-top:10px;color:#5d6259;font-size:14px">נוצר ב־${escapeHtml(formatDateTime(runStartedAt || new Date()))}</div>
        </div>

        <div style="padding:20px 24px">
          <div style="display:flex;flex-wrap:wrap;gap:10px 12px;margin-bottom:22px">
            <div style="min-width:150px;padding:12px 14px;background:#faf8f3;border:1px solid #eee8dd;border-radius:10px"><div style="font-size:12px;color:#687064">נסרקו</div><div style="font-size:24px;font-weight:800">${runStats.total_scraped}</div></div>
            <div style="min-width:150px;padding:12px 14px;background:#faf8f3;border:1px solid #eee8dd;border-radius:10px"><div style="font-size:12px;color:#687064">מקורות חדשים</div><div style="font-size:24px;font-weight:800">${runStats.total_new_sources}</div></div>
            <div style="min-width:150px;padding:12px 14px;background:#faf8f3;border:1px solid #eee8dd;border-radius:10px"><div style="font-size:12px;color:#687064">נוספו ל־transactions</div><div style="font-size:24px;font-weight:800">${runStats.total_new_transactions}</div></div>
            <div style="min-width:150px;padding:12px 14px;background:#faf8f3;border:1px solid #eee8dd;border-radius:10px"><div style="font-size:12px;color:#687064">ממתינות</div><div style="font-size:24px;font-weight:800">${runStats.total_new_pending}</div></div>
            <div style="min-width:150px;padding:12px 14px;background:#faf8f3;border:1px solid #eee8dd;border-radius:10px"><div style="font-size:12px;color:#687064">כפילויות שנחסמו</div><div style="font-size:24px;font-weight:800">${runStats.total_duplicates_prevented}</div></div>
          </div>

          <div style="font-size:18px;font-weight:800;margin:0 0 10px">רשומות חדשות שנוספו</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #eee8dd;border-radius:10px;overflow:hidden;font-size:14px">
            <thead>
              <tr style="background:#faf8f3;text-align:right">
                <th style="padding:10px 12px;border-bottom:1px solid #eee8dd">תאריך</th>
                <th style="padding:10px 12px;border-bottom:1px solid #eee8dd">בית עסק</th>
                <th style="padding:10px 12px;border-bottom:1px solid #eee8dd">ספק</th>
                <th style="padding:10px 12px;border-bottom:1px solid #eee8dd">סכום</th>
                <th style="padding:10px 12px;border-bottom:1px solid #eee8dd">קטגוריה אצלך</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>

          <div style="font-size:18px;font-weight:800;margin:24px 0 10px">סיכום ספקים</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #eee8dd;border-radius:10px;overflow:hidden;font-size:14px">
            <thead>
              <tr style="background:#faf8f3;text-align:right">
                <th style="padding:8px 10px;border-bottom:1px solid #eee8dd">ספק</th>
                <th style="padding:8px 10px;border-bottom:1px solid #eee8dd">סטטוס</th>
                <th style="padding:8px 10px;border-bottom:1px solid #eee8dd">נסרקו</th>
                <th style="padding:8px 10px;border-bottom:1px solid #eee8dd">מקורות חדשים</th>
                <th style="padding:8px 10px;border-bottom:1px solid #eee8dd">עסקאות שנוספו</th>
                <th style="padding:8px 10px;border-bottom:1px solid #eee8dd">ממתינות</th>
                <th style="padding:8px 10px;border-bottom:1px solid #eee8dd">כפילויות שנחסמו</th>
              </tr>
            </thead>
            <tbody>${providerRows}</tbody>
          </table>

          ${failuresHtml}
        </div>
      </div>
    </div>`;
}

async function sendBrevoReportEmail({ runStats, runDetails, partialFailure, reportTransactions, runStartedAt }) {
  const apiKey = process.env.BREVO_API_KEY;
  const recipients = resolveReportRecipients();
  const senderEmail = process.env.BREVO_SENDER_EMAIL || recipients[0] || "";

  if (!apiKey || !senderEmail || recipients.length === 0) {
    return { status: "skipped", reason: "Brevo report email is not configured" };
  }

  const htmlContent = buildBankScraperReportEmailHtml({
    runStats,
    runDetails,
    partialFailure,
    reportTransactions,
    runStartedAt,
  });

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
      replyTo: {
        name: process.env.BREVO_REPLY_TO_NAME || process.env.BREVO_SENDER_NAME || "Budget Lens",
        email: process.env.BREVO_REPLY_TO_EMAIL || senderEmail,
      },
      to: recipients.map((email) => ({ email })),
      subject: buildEmailSubject({ runStats, partialFailure, runStartedAt }),
      htmlContent,
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`Brevo email failed (${response.status})`);
  }

  return { status: "sent", recipientCount: recipients.length };
}

async function upsertMerchantMemoryEntry({
  supabase,
  userId,
  normalizedBusinessName,
  displayBusinessName,
  categoryName,
  source,
  confidence,
  reasoning,
  metadata = {},
}) {
  const nowIso = new Date().toISOString();
  await supabase.from("merchant_category_memory").upsert({
    user_id: userId,
    normalized_business_name: normalizedBusinessName,
    display_business_name: displayBusinessName,
    category_name: categoryName,
    source,
    confidence,
    reasoning,
    metadata,
    last_used_at: nowIso,
    updated_at: nowIso,
  }, { onConflict: "user_id,normalized_business_name" });
}

function tryParseJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const bracketMatch = raw.match(/\{[\s\S]*\}/);
  if (bracketMatch) candidates.push(bracketMatch[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
}

function buildPerplexityReasoning(payload) {
  const content = String(payload?.reasoning || payload?.explanation || payload?.notes || "").replace(/\s+/g, " ").trim();
  const citations = Array.isArray(payload?.citations) ? payload.citations.filter(Boolean).slice(0, MAX_PERPLEXITY_CITATIONS) : [];
  const citationsText = citations.length ? ` Sources: ${citations.join(", ")}` : "";
  return `${content || "Perplexity web classification"}${citationsText}`.trim();
}

async function classifyWithPerplexity({
  merchantName,
  allowedCategories,
  amount,
  paymentMethod,
  sourceCategory,
}) {
  const apiKey = requiredEnv("PERPLEXITY_API_KEY");
  const prompt = [
    "You classify personal finance transaction merchants into one of the allowed categories.",
    "Use web research when needed.",
    "Return JSON only.",
    `Merchant: ${merchantName || "Unknown merchant"}`,
    `Payment method: ${paymentMethod || "unknown"}`,
    `Amount: ${amount ?? "unknown"}`,
    `Source category / memo: ${sourceCategory || "unknown"}`,
    `Allowed categories: ${allowedCategories.join(", ")}`,
    'JSON schema: {"category_name":"<one allowed category>","reasoning":"<short reason>","citations":["<url1>","<url2>"]}',
  ].join("\n");

  const response = await fetch("https://api.perplexity.ai/v1/sonar", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "system",
          content: "You are a precise financial transaction classifier. Use web search and answer with JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      return_images: false,
      return_related_questions: false,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Perplexity API error: ${response.status} ${payload?.error?.message || payload?.error || response.statusText}`.trim());
  }

  const content = payload?.choices?.[0]?.message?.content;
  const parsed = tryParseJsonObject(content);
  if (!parsed?.category_name) {
    throw new Error("Perplexity API returned an unexpected response shape");
  }

  return {
    categoryName: String(parsed.category_name).trim(),
    reasoning: buildPerplexityReasoning(parsed),
    citations: Array.isArray(parsed.citations) ? parsed.citations.filter(Boolean).slice(0, MAX_PERPLEXITY_CITATIONS) : [],
  };
}

async function classifyMerchant({
  merchantName,
  amount,
  paymentMethod,
  sourceCategory,
  allowedCategories,
  allowedCategorySet,
  memoryMap,
  historicalMap,
  historicalEntries,
  userId,
  dryRun,
  supabase,
  stats,
  hasMerchantMemoryTable,
}) {
  const normalized = normalizeMerchantName(merchantName);
  const isCredit = amountDirection(amount) === "credit";
  const allowedForDirection = isCredit
    ? allowedCategories.filter((category) => isIncomeCategory(category))
    : allowedCategories.filter((category) => !isIncomeCategory(category));
  const allowedForDirectionSet = new Set(allowedForDirection);

  if (isCredit && allowedForDirection.length === 0) {
    return {
      categoryName: incomeKeywordCategory(merchantName, sourceCategory, allowedCategorySet),
      normalizedBusinessName: normalized,
      source: "income_default",
      reasoning: "Credit transactions are constrained to income categories",
    };
  }

  const memoryEntry = memoryMap.get(normalized);
  if (memoryEntry?.category_name && allowedForDirectionSet.has(memoryEntry.category_name)) {
    stats.total_classified_from_memory += 1;
    return {
      categoryName: memoryEntry.category_name,
      normalizedBusinessName: normalized,
      source: "memory",
      reasoning: memoryEntry.reasoning || null,
    };
  }

  const historicalCategory = historicalMap.get(normalized);
  if (historicalCategory && allowedForDirectionSet.has(historicalCategory)) {
    if (!dryRun && hasMerchantMemoryTable) {
      await upsertMerchantMemoryEntry({
        supabase,
        userId,
        normalizedBusinessName: normalized,
        displayBusinessName: merchantName,
        categoryName: historicalCategory,
        source: "transactions",
        confidence: 0.95,
        reasoning: "Matched against existing approved transactions",
      });
    }
    memoryMap.set(normalized, {
      category_name: historicalCategory,
      reasoning: "Matched against existing approved transactions",
    });
    stats.total_classified_from_memory += 1;
    return {
      categoryName: historicalCategory,
      normalizedBusinessName: normalized,
      source: "transactions",
      reasoning: "Matched against existing approved transactions",
    };
  }

  const fuzzyCandidates = historicalEntries
    .map((entry) => ({
      ...entry,
      score: fuzzyMerchantScore(normalized, entry.normalized_business_name),
    }))
    .filter((entry) => entry.score >= FUZZY_MATCH_THRESHOLD && allowedForDirectionSet.has(entry.category_name))
    .sort((left, right) => right.score - left.score);

  const bestFuzzy = fuzzyCandidates[0];
  if (bestFuzzy) {
    const reasoning = `Fuzzy matched approved transactions (${bestFuzzy.display_business_name}) with score ${bestFuzzy.score}`;
    if (!dryRun && hasMerchantMemoryTable) {
      await upsertMerchantMemoryEntry({
        supabase,
        userId,
        normalizedBusinessName: normalized,
        displayBusinessName: merchantName,
        categoryName: bestFuzzy.category_name,
        source: "transactions_fuzzy",
        confidence: Math.min(0.99, bestFuzzy.score / 100),
        reasoning,
        metadata: {
          matched_normalized_business_name: bestFuzzy.normalized_business_name,
          matched_display_business_name: bestFuzzy.display_business_name,
          fuzzy_score: bestFuzzy.score,
        },
      });
    }
    memoryMap.set(normalized, {
      category_name: bestFuzzy.category_name,
      reasoning,
    });
    stats.total_classified_from_memory += 1;
    return {
      categoryName: bestFuzzy.category_name,
      normalizedBusinessName: normalized,
      source: "transactions_fuzzy",
      reasoning,
    };
  }

  try {
    if (isCredit) {
      const categoryName = incomeKeywordCategory(merchantName, sourceCategory, allowedCategorySet);
      const reasoning = "Credit transactions are constrained to income categories";
      if (!dryRun && hasMerchantMemoryTable) {
        await upsertMerchantMemoryEntry({
          supabase,
          userId,
          normalizedBusinessName: normalized,
          displayBusinessName: merchantName,
          categoryName,
          source: "income_default",
          confidence: 0.85,
          reasoning,
        });
      }
      memoryMap.set(normalized, {
        category_name: categoryName,
        reasoning,
      });
      stats.total_classified_from_memory += 1;
      return {
        categoryName,
        normalizedBusinessName: normalized,
        source: "income_default",
        reasoning,
      };
    }

    const perplexity = await classifyWithPerplexity({
      merchantName,
      allowedCategories,
      amount,
      paymentMethod,
      sourceCategory,
    });
    const categoryName = allowedCategorySet.has(perplexity.categoryName) ? perplexity.categoryName : DEFAULT_CATEGORY;
    const reasoning = allowedCategorySet.has(perplexity.categoryName)
      ? perplexity.reasoning
      : `${perplexity.reasoning} Fallbacked to ${DEFAULT_CATEGORY} because the returned category was not allowed.`;

    if (!dryRun && hasMerchantMemoryTable) {
      await upsertMerchantMemoryEntry({
        supabase,
        userId,
        normalizedBusinessName: normalized,
        displayBusinessName: merchantName,
        categoryName,
        source: "perplexity",
        confidence: categoryName === perplexity.categoryName ? 0.7 : 0.3,
        reasoning,
        metadata: {
          citations: perplexity.citations,
        },
      });
    }
    memoryMap.set(normalized, {
      category_name: categoryName,
      reasoning,
    });
    stats.total_classified_from_ai += 1;
    return {
      categoryName,
      normalizedBusinessName: normalized,
      source: "perplexity",
      reasoning,
    };
  } catch (error) {
    const reasoning = `Perplexity fallback failed: ${formatError(error)}`;
    if (!dryRun && hasMerchantMemoryTable) {
      await upsertMerchantMemoryEntry({
        supabase,
        userId,
        normalizedBusinessName: normalized,
        displayBusinessName: merchantName,
        categoryName: DEFAULT_CATEGORY,
        source: "perplexity_failed",
        confidence: 0.1,
        reasoning,
      });
    }
    memoryMap.set(normalized, {
      category_name: DEFAULT_CATEGORY,
      reasoning,
    });
    return {
      categoryName: DEFAULT_CATEGORY,
      normalizedBusinessName: normalized,
      source: "fallback_default",
      reasoning,
    };
  }
}

function providerDefinitions(env) {
  return [
    {
      key: "cal",
      bankType: "cal",
      companyId: CompanyTypes.visaCal,
      paymentMethod: "cal",
      fullMonthRescrape: true,
      credentials: env.CAL_USERNAME && env.CAL_PASSWORD ? {
        username: env.CAL_USERNAME,
        password: env.CAL_PASSWORD,
      } : null,
    },
    {
      key: "max",
      bankType: "max",
      companyId: CompanyTypes.max,
      paymentMethod: "max",
      fullMonthRescrape: true,
      credentials: env.MAX_USERNAME && env.MAX_PASSWORD ? {
        username: env.MAX_USERNAME,
        password: env.MAX_PASSWORD,
      } : null,
    },
    {
      key: "yahav",
      bankType: "yahav",
      companyId: CompanyTypes.yahav,
      paymentMethod: "YahavBank",
      credentials: env.YAHAV_USERNAME && env.YAHAV_PASSWORD && env.YAHAV_NATIONAL_ID ? {
        username: env.YAHAV_USERNAME,
        password: env.YAHAV_PASSWORD,
        nationalID: env.YAHAV_NATIONAL_ID,
      } : null,
    },
    {
      key: "amex",
      bankType: "amex",
      companyId: CompanyTypes.amex,
      paymentMethod: "amex",
      fullMonthRescrape: true,
      credentials: env.AMEX_ID && env.AMEX_PASSWORD && env.AMEX_CARD6DIGITS ? {
        id: env.AMEX_ID,
        password: env.AMEX_PASSWORD,
        card6Digits: env.AMEX_CARD6DIGITS,
      } : null,
    },
  ];
}

async function ensureConfig(supabase, providerKey, userId) {
  const { data: existing, error } = await supabase
    .from("bank_scraper_configs")
    .select("*")
    .eq("user_id", userId)
    .eq("bank_type", providerKey)
    .maybeSingle();

  if (error) throw error;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from("bank_scraper_configs")
    .insert({
      user_id: userId,
      config_name: providerKey.toUpperCase(),
      bank_type: providerKey,
      credentials_encrypted: "managed-in-.env.local",
      is_active: true,
    })
    .select("*")
    .single();

  if (insertError) throw insertError;
  return created;
}

async function loadHistoricalCategoryIndex(supabase, userId) {
  const rows = await paginateSelect((from, to) =>
    supabase
      .from("transactions")
      .select("business_name,category_name,status,user_id")
      .eq("user_id", userId)
      .eq("status", "approved")
      .not("business_name", "is", null)
      .not("category_name", "is", null)
      .range(from, to)
  );

  const counts = new Map();
  for (const row of rows) {
    const normalized = normalizeMerchantName(row.business_name);
    if (!normalized || !row.category_name) continue;
    const bucket = counts.get(normalized) || new Map();
    bucket.set(row.category_name, (bucket.get(row.category_name) || 0) + 1);
    counts.set(normalized, bucket);
  }

  const resolved = new Map();
  const entries = [];
  for (const [normalized, bucket] of counts.entries()) {
    const ranked = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
    const best = ranked[0]?.[0];
    if (best) {
      resolved.set(normalized, best);
      entries.push({
        normalized_business_name: normalized,
        display_business_name: normalized,
        category_name: best,
        category_counts: Object.fromEntries(ranked),
      });
    }
  }
  return { exactMap: resolved, entries };
}

async function loadMerchantMemory(supabase, userId) {
  try {
    const rows = await paginateSelect((from, to) =>
      supabase
        .from("merchant_category_memory")
        .select("normalized_business_name,category_name,reasoning")
        .eq("user_id", userId)
        .range(from, to)
    );

    const memory = new Map();
    for (const row of rows) memory.set(row.normalized_business_name, row);
    return { hasTable: true, memory };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return { hasTable: false, memory: new Map() };
    }
    throw error;
  }
}

async function loadAllowedCategories(supabase) {
  const { data, error } = await supabase
    .from("category_order")
    .select("category_name")
    .order("display_order", { ascending: true })
    .limit(500);

  if (error) throw error;

  const names = Array.from(new Set((data || []).map((row) => row.category_name).filter(Boolean)));
  if (!names.includes(DEFAULT_CATEGORY)) names.push(DEFAULT_CATEGORY);
  return names;
}

async function loadExistingSourceIds(supabase, configId) {
  const rows = await paginateSelect((from, to) =>
    supabase
      .from("bank_scraper_transactions")
      .select("id,transaction_identifier")
      .eq("config_id", configId)
      .range(from, to)
  );

  const map = new Map();
  for (const row of rows) map.set(row.transaction_identifier, row.id);
  return map;
}

async function loadExistingPendingSourceIds(supabase, sourceIds) {
  const set = new Set();
  for (const idsChunk of chunk(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("bank_scraper_pending_transactions")
      .select("bank_scraper_source_id")
      .in("bank_scraper_source_id", idsChunk);
    if (error) throw error;
    for (const row of data || []) set.add(row.bank_scraper_source_id);
  }
  return set;
}

async function syncObservedSourceRows(supabase, candidates, sourceRowsById) {
  const updates = [];
  for (const candidate of candidates) {
    const sourceId = candidate.existingSourceId;
    if (!sourceId || sourceId <= 0) continue;
    const existingRow = sourceRowsById.get(sourceId);
    if (!existingRow) continue;

    const nextStatus = String(candidate.txn.status || "completed").toLowerCase();
    const nextProcessedDate = candidate.txn.processedDate || candidate.txn.date || null;
    const nextTransactionDate = candidate.txn.date || null;
    const nextChargedAmount = resolveScrapedAmount(candidate.txn);
    const nextOriginalAmount = candidate.txn.originalAmount ?? candidate.txn.chargedAmount ?? 0;
    const nextDescription = candidate.txn.description || "";
    const nextMemo = candidate.txn.memo || null;
    const nextType = candidate.txn.type || "normal";
    const nextInstallmentNumber = candidate.txn.installments?.number ?? null;
    const nextTotalInstallments = candidate.txn.installments?.total ?? null;

    const changed = (
      String(existingRow.status || "") !== nextStatus
      || String(existingRow.processed_date || "") !== String(nextProcessedDate || "")
      || String(existingRow.transaction_date || "") !== String(nextTransactionDate || "")
      || Math.abs(Number(existingRow.charged_amount || 0) - Number(nextChargedAmount || 0)) > 0.000001
      || Math.abs(Number(existingRow.original_amount || 0) - Number(nextOriginalAmount || 0)) > 0.000001
      || String(existingRow.description || "") !== String(nextDescription || "")
      || String(existingRow.memo || "") !== String(nextMemo || "")
      || String(existingRow.transaction_type || "") !== String(nextType || "")
      || Number(existingRow.installment_number ?? null) !== Number(nextInstallmentNumber ?? null)
      || Number(existingRow.total_installments ?? null) !== Number(nextTotalInstallments ?? null)
    );

    if (!changed) continue;

    updates.push({
      id: sourceId,
      patch: {
        status: nextStatus,
        processed_date: nextProcessedDate,
        transaction_date: nextTransactionDate,
        charged_amount: nextChargedAmount,
        original_amount: nextOriginalAmount,
        description: nextDescription,
        memo: nextMemo,
        transaction_type: nextType,
        installment_number: nextInstallmentNumber,
        total_installments: nextTotalInstallments,
      },
    });
  }

  for (const update of updates) {
    const { error } = await supabase
      .from("bank_scraper_transactions")
      .update(update.patch)
      .eq("id", update.id);
    if (error) throw error;
    sourceRowsById.set(update.id, { ...(sourceRowsById.get(update.id) || {}), ...update.patch });
  }

  return updates.length;
}

async function deletePendingRowsBySourceIds(supabase, sourceIds) {
  const removed = [];
  for (const idsChunk of chunk(sourceIds.filter((value) => value > 0), 200)) {
    if (idsChunk.length === 0) continue;
    const { data, error } = await supabase
      .from("bank_scraper_pending_transactions")
      .delete()
      .in("bank_scraper_source_id", idsChunk)
      .select("id,bank_scraper_source_id,business_name,payment_date");
    if (error) throw error;
    removed.push(...(data || []));
  }
  return removed;
}

async function reconcileStaleRepresentedPendingRows(supabase, userId, paymentDateFrom, approvedLooseKeys) {
  const pendingRows = await paginateSelect((from, to) => {
    let query = supabase
      .from("bank_scraper_pending_transactions")
      .select("id,bank_scraper_source_id,business_name,payment_date,charge_date,amount,original_amount,payment_method,config_id,created_at,file_source")
      .eq("user_id", userId)
      .eq("status", "pending")
      .eq("source_type", "bank_scraper")
      .range(from, to);

    if (paymentDateFrom) {
      query = query.gte("payment_date", paymentDateFrom);
    }

    return query;
  });

  if (pendingRows.length === 0) return [];

  const sourceRowsById = await loadSourceRowsByIds(
    supabase,
    pendingRows.map((row) => row.bank_scraper_source_id).filter((value) => value > 0)
  );
  const approvedSourceIds = await loadExistingTransactionSourceIds(
    supabase,
    pendingRows.map((row) => row.bank_scraper_source_id).filter((value) => value > 0)
  );

  const removed = [];
  for (const row of pendingRows) {
    const effectiveAmount = resolveStoredAmount(row);
    const looseKey = buildLooseTransactionRepresentationKey({
      businessName: row.business_name,
      paymentDate: row.payment_date,
      amount: effectiveAmount,
      paymentMethod: row.payment_method,
    });
    const sourceRow = row.bank_scraper_source_id ? sourceRowsById.get(row.bank_scraper_source_id) : null;
    const represented = (
      (row.bank_scraper_source_id > 0 && approvedSourceIds.has(row.bank_scraper_source_id))
      || approvedLooseKeys.has(looseKey)
    );
    const safeToClear = represented && (
      sourceRow?.status === "completed"
      || isOlderThanDays(row.created_at, 3)
    );

    if (!safeToClear) continue;

    if (row.bank_scraper_source_id > 0) {
      await ignoreBankScraperSourceRow(supabase, {
        userId,
        sourceId: row.bank_scraper_source_id,
        reason: sourceRow?.status === "completed"
          ? "pending_completed_reconciled"
          : "stale_pending_duplicate_of_approved_transaction",
        notes: `Auto-cleared stale pending row for ${row.business_name || row.file_source || "bank scraper"} on ${row.payment_date || "unknown date"}`,
      });
    }

    const { error } = await supabase
      .from("bank_scraper_pending_transactions")
      .delete()
      .eq("id", row.id);
    if (error) throw error;

    removed.push({
      id: row.id,
      bank_scraper_source_id: row.bank_scraper_source_id,
      business_name: row.business_name,
      payment_date: row.payment_date,
      reason: sourceRow?.status === "completed" ? "completed" : "represented_by_approved",
    });
  }

  return removed;
}

async function reconcileDuplicatePendingRows(supabase, userId, paymentDateFrom) {
  const rows = await paginateSelect((from, to) => {
    let query = supabase
      .from("bank_scraper_pending_transactions")
      .select("id,config_id,business_name,payment_date,payment_method,transaction_type,payment_number,total_payments,bank_scraper_source_id,transaction_hash,created_at,reviewed_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .eq("source_type", "bank_scraper")
      .range(from, to);

    if (paymentDateFrom) {
      query = query.gte("payment_date", paymentDateFrom);
    }

    return query;
  });

  const groups = new Map();
  for (const row of rows) {
    const key = row.bank_scraper_source_id
      ? `source:${row.bank_scraper_source_id}`
      : row.transaction_hash
        ? `hash:${row.transaction_hash}`
        : buildPendingLifecycleIdentityKey({
            configId: row.config_id,
            businessName: row.business_name,
            paymentDate: row.payment_date,
            paymentMethod: row.payment_method,
            paymentNumber: row.payment_number,
            totalPayments: row.total_payments,
            transactionType: row.transaction_type,
          });
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const removed = [];
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    const ranked = bucket.slice().sort((left, right) => {
      const reviewedDelta = Number(Boolean(right.reviewed_at)) - Number(Boolean(left.reviewed_at));
      if (reviewedDelta !== 0) return reviewedDelta;
      return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    });
    const keep = ranked[0];
    const duplicateIds = ranked.slice(1).map((row) => row.id);
    if (duplicateIds.length === 0) continue;
    const { error } = await supabase
      .from("bank_scraper_pending_transactions")
      .delete()
      .in("id", duplicateIds);
    if (error) throw error;
    removed.push({
      kept_id: keep.id,
      removed_ids: duplicateIds,
      business_name: keep.business_name,
      payment_date: keep.payment_date,
      bank_scraper_source_id: keep.bank_scraper_source_id,
    });
  }

  return removed;
}

async function loadExistingTransactionHashes(supabase, hashes) {
  const set = new Set();
  for (const hashesChunk of chunk(hashes, 200)) {
    const { data, error } = await supabase
      .from("transactions")
      .select("transaction_hash")
      .in("transaction_hash", hashesChunk);
    if (error) throw error;
    for (const row of data || []) if (row.transaction_hash) set.add(row.transaction_hash);
  }
  return set;
}

async function loadExistingTransactionSourceIds(supabase, sourceIds) {
  const set = new Set();
  for (const idsChunk of chunk(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("transactions")
      .select("bank_scraper_source_id")
      .in("bank_scraper_source_id", idsChunk);
    if (error) throw error;
    for (const row of data || []) if (row.bank_scraper_source_id) set.add(row.bank_scraper_source_id);
  }
  return set;
}

async function loadSourceRowsByIds(supabase, sourceIds) {
  const map = new Map();
  for (const idsChunk of chunk(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("bank_scraper_transactions")
      .select("id,status,account_number,transaction_date,processed_date,description,transaction_type,installment_number,total_installments,charged_amount,original_amount")
      .in("id", idsChunk);
    if (error) throw error;
    for (const row of data || []) if (row?.id) map.set(row.id, row);
  }
  return map;
}

function parseSplitOriginalAmount(notes) {
  const match = String(notes || "").match(/\[SPLIT:[^:]+:([^:]+):/);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : null;
}

async function loadExistingSplitRepresentationKeys(supabase, userId, paymentDateFrom) {
  const rows = await paginateSelect((from, to) => {
    let query = supabase
      .from("transactions")
      .select("business_name,payment_date,charge_date,payment_method,notes")
      .eq("user_id", userId)
      .eq("status", "approved")
      .not("notes", "is", null)
      .range(from, to);

    if (paymentDateFrom) {
      query = query.gte("payment_date", paymentDateFrom);
    }

    return query;
  });

  const keys = new Set();
  for (const row of rows) {
    const splitOriginalAmount = parseSplitOriginalAmount(row.notes);
    if (!splitOriginalAmount || !row.business_name) continue;
    keys.add(buildTransactionRepresentationKey({
      businessName: row.business_name,
      paymentDate: row.payment_date,
      chargeDate: row.charge_date,
      amount: splitOriginalAmount,
      paymentMethod: row.payment_method,
    }));
  }
  return keys;
}

async function loadExistingApprovedLooseRepresentationKeys(supabase, userId, paymentDateFrom) {
  const rows = await paginateSelect((from, to) => {
    let query = supabase
      .from("transactions")
      .select("business_name,payment_date,amount,payment_method")
      .eq("user_id", userId)
      .eq("status", "approved")
      .not("business_name", "is", null)
      .range(from, to);

    if (paymentDateFrom) {
      query = query.gte("payment_date", paymentDateFrom);
    }

    return query;
  });

  const keys = new Set();
  for (const row of rows) {
    keys.add(buildLooseTransactionRepresentationKey({
      businessName: row.business_name,
      paymentDate: row.payment_date,
      amount: row.amount,
      paymentMethod: row.payment_method,
    }));
  }
  return keys;
}

async function loadPendingCompletionCandidates(supabase, userId, configId, paymentDateFrom) {
  const rows = await paginateSelect((from, to) => {
    let query = supabase
      .from("transactions")
      .select("id,config_id,business_name,payment_date,amount,payment_method,bank_scraper_source_id,source_type,status,payment_number,total_payments,transaction_type,original_amount")
      .eq("user_id", userId)
      .eq("config_id", configId)
      .eq("status", "approved")
      .eq("source_type", "bank_scraper")
      .not("business_name", "is", null)
      .not("bank_scraper_source_id", "is", null)
      .range(from, to);

    if (paymentDateFrom) {
      query = query.gte("payment_date", paymentDateFrom);
    }

    return query;
  });

  const sourceRowsById = await loadSourceRowsByIds(
    supabase,
    rows.map((row) => row.bank_scraper_source_id).filter((value) => value > 0)
  );

  const exactMap = new Map();
  const ambiguousKeys = new Set();
  const fuzzyCandidates = [];

  for (const row of rows) {
    const sourceRow = sourceRowsById.get(row.bank_scraper_source_id);
    if (!sourceRow || sourceRow.status !== "pending") continue;

    const key = buildPendingLifecycleIdentityKey({
      configId: row.config_id,
      businessName: row.business_name,
      paymentDate: row.payment_date,
      paymentMethod: row.payment_method,
      paymentNumber: row.payment_number,
      totalPayments: row.total_payments,
      transactionType: row.transaction_type,
    });

    if (exactMap.has(key)) {
      ambiguousKeys.add(key);
      continue;
    }

    exactMap.set(key, {
      transactionId: row.id,
      bankScraperSourceId: row.bank_scraper_source_id,
    });

    fuzzyCandidates.push({
      transactionId: row.id,
      bankScraperSourceId: row.bank_scraper_source_id,
      configId: row.config_id,
      businessName: row.business_name,
      normalizedBusinessName: normalizeMerchantName(row.business_name),
      paymentDate: row.payment_date,
      paymentMethod: row.payment_method,
      amount: row.amount,
      originalAmount: row.original_amount,
      paymentNumber: row.payment_number,
      totalPayments: row.total_payments,
      transactionType: row.transaction_type,
      accountNumber: sourceRow.account_number || "",
    });
  }

  for (const key of ambiguousKeys) exactMap.delete(key);
  return { exactMap, fuzzyCandidates };
}

function findFuzzyPendingCompletionCandidate(fuzzyCandidates, row, accountNumber) {
  const normalizedBusinessName = normalizeMerchantName(row.business_name);
  const comparable = fuzzyCandidates
    .filter((candidate) => candidate.configId === row.config_id)
    .filter((candidate) => candidate.bankScraperSourceId !== row.bank_scraper_source_id)
    .filter((candidate) => candidate.accountNumber === (accountNumber || ""))
    .filter((candidate) => candidate.paymentMethod === row.payment_method)
    .filter((candidate) => dateDistanceInDays(candidate.paymentDate, row.payment_date) <= 3)
    .filter((candidate) => candidate.paymentNumber === row.payment_number)
    .filter((candidate) => candidate.totalPayments === row.total_payments)
    .filter((candidate) => candidate.transactionType === row.transaction_type)
    .filter((candidate) => Math.abs(roundAbsAmount(candidate.originalAmount) - roundAbsAmount(row.original_amount)) <= 0.01)
    .map((candidate) => ({
      ...candidate,
      score: fuzzyMerchantScore(candidate.normalizedBusinessName, normalizedBusinessName),
    }))
    .filter((candidate) => candidate.score >= 90)
    .sort((left, right) => right.score - left.score);

  if (comparable.length !== 1) return null;
  return comparable[0];
}

async function loadExistingLifecycleKeys(supabase, userId, configId, paymentDateFrom) {
  const rows = await paginateSelect((from, to) => {
    let query = supabase
      .from("transactions")
      .select("id,config_id,business_name,payment_date,charge_date,amount,payment_method,bank_scraper_source_id,payment_number,total_payments,transaction_type")
      .eq("user_id", userId)
      .eq("config_id", configId)
      .eq("status", "approved")
      .eq("source_type", "bank_scraper")
      .not("business_name", "is", null)
      .range(from, to);

    if (paymentDateFrom) {
      query = query.gte("payment_date", paymentDateFrom);
    }

    return query;
  });

  const keys = new Map();
  for (const row of rows) {
    const key = buildPendingLifecycleIdentityKey({
      configId: row.config_id,
      businessName: row.business_name,
      paymentDate: row.payment_date,
      paymentMethod: row.payment_method,
      paymentNumber: row.payment_number,
      totalPayments: row.total_payments,
      transactionType: row.transaction_type,
    });
    const bucket = keys.get(key) || [];
    bucket.push({
      transactionId: row.id,
      bankScraperSourceId: row.bank_scraper_source_id,
      chargeDate: row.charge_date,
    });
    keys.set(key, bucket);
  }
  return keys;
}

async function loadIgnoredSourceIds(supabase, userId, sourceIds) {
  const set = new Set();
  for (const idsChunk of chunk(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("bank_scraper_ignored_transactions")
      .select("bank_scraper_source_id")
      .eq("user_id", userId)
      .in("bank_scraper_source_id", idsChunk);
    if (error) {
      if (isMissingRelationError(error)) return new Set();
      throw error;
    }
    for (const row of data || []) if (row.bank_scraper_source_id) set.add(row.bank_scraper_source_id);
  }
  return set;
}

async function ignoreBankScraperSourceRow(supabase, {
  userId,
  sourceId,
  reason,
  notes,
}) {
  const { error } = await supabase
    .from("bank_scraper_ignored_transactions")
    .upsert({
      user_id: userId,
      bank_scraper_source_id: sourceId,
      reason,
      notes,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id,bank_scraper_source_id",
    });

  if (error) {
    if (isMissingRelationError(error)) return false;
    throw error;
  }

  return true;
}

async function reconcileRecentPendingCompletedDuplicates(supabase, userId, paymentDateFrom) {
  const rows = await paginateSelect((from, to) => {
    let query = supabase
      .from("transactions")
      .select("id,user_id,config_id,business_name,amount,payment_date,charge_date,payment_method,payment_identifier,category_name,flow_month,notes,excluded_from_flow,source_type,original_amount,transaction_hash,is_transfer,payment_number,total_payments,original_currency,source_category,transaction_type,file_source,bank_scraper_source_id,created_at,status,cash_flow_id,currency,payment_month,payment_year")
      .eq("user_id", userId)
      .eq("status", "approved")
      .eq("source_type", "bank_scraper")
      .not("bank_scraper_source_id", "is", null)
      .range(from, to);

    if (paymentDateFrom) {
      query = query.gte("payment_date", paymentDateFrom);
    }

    return query;
  });

  const sourceRowsById = await loadSourceRowsByIds(
    supabase,
    rows.map((row) => row.bank_scraper_source_id).filter((value) => value > 0)
  );

  const groups = new Map();
  for (const row of rows) {
    const key = buildPendingLifecycleIdentityKey({
      configId: row.config_id,
      businessName: row.business_name,
      paymentDate: row.payment_date,
      paymentMethod: row.payment_method,
      paymentNumber: row.payment_number,
      totalPayments: row.total_payments,
      transactionType: row.transaction_type,
    });
    const bucket = groups.get(key) || [];
    bucket.push({
      ...row,
      source_row_status: sourceRowsById.get(row.bank_scraper_source_id)?.status || null,
    });
    groups.set(key, bucket);
  }

  const fixes = [];
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    const pending = bucket.find((row) => row.source_row_status === "pending");
    const completed = bucket.find((row) => row.source_row_status === "completed");
    if (!pending || !completed) continue;
    fixes.push({ pending, completed });
  }

  const matchedIds = new Set(fixes.flatMap((fix) => [fix.pending.id, fix.completed.id]));
  const rowsByIdentity = rows.map((row) => ({
    ...row,
    source_row_status: sourceRowsById.get(row.bank_scraper_source_id)?.status || null,
    normalized_business_name: normalizeMerchantName(row.business_name),
    account_number: sourceRowsById.get(row.bank_scraper_source_id)?.account_number || "",
  }));

  for (const pending of rowsByIdentity) {
    if (matchedIds.has(pending.id) || pending.source_row_status !== "pending") continue;

    const candidates = rowsByIdentity
      .filter((completed) => !matchedIds.has(completed.id))
      .filter((completed) => completed.source_row_status === "completed")
      .filter((completed) => completed.id !== pending.id)
      .filter((completed) => completed.config_id === pending.config_id)
      .filter((completed) => completed.account_number === pending.account_number)
      .filter((completed) => completed.payment_method === pending.payment_method)
      .filter((completed) => dateDistanceInDays(completed.payment_date, pending.payment_date) <= 3)
      .filter((completed) => completed.payment_number === pending.payment_number)
      .filter((completed) => completed.total_payments === pending.total_payments)
      .filter((completed) => completed.transaction_type === pending.transaction_type)
      .filter((completed) => Math.abs(roundAbsAmount(sourceRowsById.get(completed.bank_scraper_source_id)?.original_amount) - roundAbsAmount(sourceRowsById.get(pending.bank_scraper_source_id)?.original_amount)) <= 0.01)
      .map((completed) => ({
        pending,
        completed,
        score: fuzzyMerchantScore(pending.normalized_business_name, completed.normalized_business_name),
      }))
      .filter((candidate) => candidate.score >= 90)
      .sort((left, right) => right.score - left.score);

    if (candidates.length !== 1) continue;
    fixes.push({ pending, completed: candidates[0].completed });
    matchedIds.add(pending.id);
    matchedIds.add(candidates[0].completed.id);
  }

  const applied = [];
  for (const fix of fixes) {
    const tempHash = sha1(`${fix.pending.transaction_hash}|reconcile|${fix.completed.id}`);
    const { error: tempError } = await supabase
      .from("transactions")
      .update({
        transaction_hash: tempHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", fix.pending.id);
    if (tempError) throw tempError;

    const { error: deleteError } = await supabase
      .from("transactions")
      .delete()
      .eq("id", fix.completed.id);
    if (deleteError) throw deleteError;

    const { error: finalError } = await supabase
      .from("transactions")
      .update({
        amount: fix.completed.amount,
        payment_date: fix.completed.payment_date,
        charge_date: fix.completed.charge_date,
        payment_identifier: fix.completed.payment_identifier,
        original_amount: fix.completed.original_amount,
        original_currency: fix.completed.original_currency,
        transaction_type: fix.completed.transaction_type,
        payment_number: fix.completed.payment_number,
        total_payments: fix.completed.total_payments,
        source_category: fix.completed.source_category,
        file_source: fix.completed.file_source,
        bank_scraper_source_id: fix.completed.bank_scraper_source_id,
        transaction_hash: fix.completed.transaction_hash,
        payment_month: fix.completed.payment_month,
        payment_year: fix.completed.payment_year,
        flow_month: fix.completed.flow_month,
        updated_at: new Date().toISOString(),
      })
      .eq("id", fix.pending.id);
    if (finalError) throw finalError;

    applied.push({
      business_name: fix.pending.business_name,
      kept_transaction_id: fix.pending.id,
      removed_transaction_id: fix.completed.id,
      final_source_id: fix.completed.bank_scraper_source_id,
    });
  }

  return applied;
}

async function reconcileLegacyBankScraperDuplicates(supabase, userId, paymentDateFrom) {
  const rows = await paginateSelect((from, to) => {
    let query = supabase
      .from("transactions")
      .select("id,user_id,config_id,business_name,amount,payment_date,charge_date,payment_method,payment_identifier,category_name,flow_month,notes,excluded_from_flow,source_type,original_amount,transaction_hash,is_transfer,payment_number,total_payments,original_currency,source_category,transaction_type,file_source,bank_scraper_source_id,created_at,status,cash_flow_id,currency,payment_month,payment_year")
      .eq("user_id", userId)
      .eq("status", "approved")
      .range(from, to);

    if (paymentDateFrom) {
      query = query.gte("payment_date", paymentDateFrom);
    }

    return query;
  });

  const normalized = rows.map((row) => ({
    ...row,
    normalized_business_name: normalizeMerchantName(row.business_name),
    amount_abs: roundAbsAmount(row.amount),
  }));

  const matchedIds = new Set();
  const applied = [];

  for (const scraperRow of normalized.filter((row) => row.bank_scraper_source_id)) {
    if (matchedIds.has(scraperRow.id)) continue;

    const candidates = normalized
      .filter((legacyRow) => !legacyRow.bank_scraper_source_id)
      .filter((legacyRow) => !matchedIds.has(legacyRow.id))
      .filter((legacyRow) => legacyRow.payment_method === scraperRow.payment_method)
      .filter((legacyRow) => Math.abs(legacyRow.amount_abs - scraperRow.amount_abs) <= 0.01)
      .filter((legacyRow) => dateDistanceInDays(legacyRow.payment_date, scraperRow.payment_date) <= 3)
      .map((legacyRow) => ({
        legacyRow,
        score: fuzzyMerchantScore(legacyRow.normalized_business_name, scraperRow.normalized_business_name),
      }))
      .filter((candidate) => candidate.score >= 90)
      .sort((left, right) => right.score - left.score);

    if (candidates.length !== 1) continue;

    const legacyRow = candidates[0].legacyRow;
    const update = {};
    if (legacyRow.category_name && legacyRow.category_name !== scraperRow.category_name) update.category_name = legacyRow.category_name;
    if (legacyRow.source_category && !scraperRow.source_category) update.source_category = legacyRow.source_category;
    if (legacyRow.notes && (!scraperRow.notes || /^\[AUTO:/u.test(String(scraperRow.notes || "")))) update.notes = legacyRow.notes;
    if (legacyRow.excluded_from_flow !== scraperRow.excluded_from_flow) update.excluded_from_flow = legacyRow.excluded_from_flow;

    if (Object.keys(update).length > 0) {
      const { error: updateError } = await supabase
        .from("transactions")
        .update(update)
        .eq("id", scraperRow.id);
      if (updateError) throw updateError;
    }

    const { error: deleteError } = await supabase
      .from("transactions")
      .delete()
      .eq("id", legacyRow.id);
    if (deleteError) throw deleteError;

    matchedIds.add(scraperRow.id);
    matchedIds.add(legacyRow.id);
    applied.push({
      kept_transaction_id: scraperRow.id,
      removed_transaction_id: legacyRow.id,
      business_name: scraperRow.business_name,
      update,
    });
  }

  return applied;
}

async function scrapeProvider(provider, startDate) {
  const maxAttempts = PROVIDER_RETRY_ATTEMPTS[provider.key] || 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const child = spawnSync(
      process.execPath,
      [
        __filename,
        `--scrape-provider-helper=${provider.key}`,
        `--start-date=${startDate.toISOString()}`,
      ],
      {
        cwd: repoRoot,
        env: process.env,
        encoding: "utf8",
        timeout: PROVIDER_SCRAPE_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      }
    );

    try {
      if (child.error) {
        const timedOut = child.error?.code === "ETIMEDOUT";
        throw new Error(
          timedOut
            ? `Provider ${provider.key} timed out after ${Math.round(PROVIDER_SCRAPE_TIMEOUT_MS / 1000)}s`
            : `Provider ${provider.key} helper failed: ${formatError(child.error)}`
        );
      }

      if (child.status !== 0) {
        throw new Error((child.stderr || child.stdout || `Provider ${provider.key} helper exited with code ${child.status}`).trim());
      }

      return JSON.parse((child.stdout || "").trim());
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetryProviderError(provider.key, error)) break;
      log(`Retrying ${provider.key} scrape`, `attempt ${attempt + 1}/${maxAttempts}: ${formatError(error)}`);
      await sleep(PROVIDER_RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Provider ${provider.key} helper failed`);
}

async function runScrapeProviderHelper(cli) {
  loadEnv();
  if (!cli.helperProvider) throw new Error("Missing helper provider");
  if (!cli.helperStartDate) throw new Error("Missing helper start date");

  const provider = providerDefinitions(process.env).find((candidate) => candidate.key === cli.helperProvider);
  if (!provider || !provider.credentials) {
    throw new Error(`Provider ${cli.helperProvider} is not configured`);
  }

  const startDate = parseDate(cli.helperStartDate);
  if (!startDate) throw new Error(`Invalid helper start date: ${cli.helperStartDate}`);

  const scraper = createScraper({
    companyId: provider.companyId,
    startDate,
    combineInstallments: false,
    showBrowser: envFlagEnabled("BANK_SCRAPER_SHOW_BROWSER"),
    timeout: 120000,
    defaultTimeout: 120000,
    storeFailureScreenShotPath: path.join(repoRoot, `${provider.key}-failure-latest.png`),
  });

  const result = await scraper.scrape(provider.credentials);
  process.stdout.write(JSON.stringify(result));
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.helperProvider) {
    await runScrapeProviderHelper(cli);
    return;
  }

  loadEnv();
  const runStartedAt = new Date();
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = process.env.SUPABASE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SECRET or SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const allProviders = providerDefinitions(process.env).filter((provider) => provider.credentials);
  const providers = cli.providers ? allProviders.filter((provider) => cli.providers.includes(provider.key)) : allProviders;

  if (providers.length === 0) {
    throw new Error("No bank providers are configured in .env.local");
  }

  const allowedCategories = await loadAllowedCategories(supabase);
  const allowedCategorySet = new Set(allowedCategories);
  const historicalIndex = await loadHistoricalCategoryIndex(supabase, MAIN_USER_ID);
  const historicalMap = historicalIndex.exactMap;
  const historicalEntries = historicalIndex.entries;
  const merchantMemory = await loadMerchantMemory(supabase, MAIN_USER_ID);
  const memoryMap = merchantMemory.memory;
  const hasMerchantMemoryTable = merchantMemory.hasTable;
  const dedupeLookbackStart = new Date(Date.now() - START_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const existingSplitRepresentationKeys = await loadExistingSplitRepresentationKeys(supabase, MAIN_USER_ID, dedupeLookbackStart);
  const existingApprovedLooseRepresentationKeys = await loadExistingApprovedLooseRepresentationKeys(supabase, MAIN_USER_ID, dedupeLookbackStart);

  const runStats = {
    total_scraped: 0,
    total_new_sources: 0,
    total_new_transactions: 0,
    total_new_pending: 0,
    total_duplicates_prevented: 0,
    total_classified_from_memory: 0,
    total_classified_from_ai: 0,
    total_failed_providers: 0,
  };

  let runId = null;
  let hasSyncRunsTable = false;
  if (!cli.dryRun) {
    log("Opening sync run record");
    try {
      const { data, error } = await supabase
        .from("bank_scraper_sync_runs")
        .insert({
          user_id: MAIN_USER_ID,
          triggered_by: "launchd",
          source: "local-script",
          providers: providers.map((provider) => provider.key),
        })
        .select("id")
        .single();
      if (error) throw error;
      hasSyncRunsTable = true;
      runId = data.id;
      log("Sync run record created", runId);
    } catch (error) {
      log("Skipping sync run record", formatError(error));
    }
  }

  const runDetails = [];
  const insertedReportTransactions = [];
  let partialFailure = false;
  let notificationEmail = { status: "not_attempted" };
  let duplicateCleanup = [];
  let legacyDuplicateCleanup = [];
  let pendingDuplicateCleanup = [];

  try {
    for (const provider of providers) {
      const config = await ensureConfig(supabase, provider.bankType, MAIN_USER_ID);
      const pendingCompletionCandidates = await loadPendingCompletionCandidates(
        supabase,
        MAIN_USER_ID,
        config.id,
        dedupeLookbackStart
      );
      const existingLifecycleKeys = await loadExistingLifecycleKeys(
        supabase,
        MAIN_USER_ID,
        config.id,
        dedupeLookbackStart
      );
      const baseStartDate = parseDate(config.last_scrape_date)
        ? new Date(Math.max(
            Date.now() - START_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
            parseDate(config.last_scrape_date).getTime() - 2 * 24 * 60 * 60 * 1000
          ))
        : new Date(Date.now() - START_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const startDate = provider.fullMonthRescrape
        ? new Date(Math.min(baseStartDate.getTime(), startOfMonth(new Date()).getTime()))
        : baseStartDate;

      const providerDetail = {
        provider: provider.key,
        scraped: 0,
        newSources: 0,
        newTransactions: 0,
        newPending: 0,
        duplicatesPrevented: 0,
        status: "success",
        errors: [],
      };

      const startedAt = Date.now();
      try {
        log(`Scraping ${provider.key} from ${startDate.toISOString().slice(0, 10)}`);
        const result = await scrapeProvider(provider, startDate);
        if (!result.success) {
          throw new Error(result.errorMessage || result.errorType || "Unknown scraper error");
        }

        const sourceIdMap = await loadExistingSourceIds(supabase, config.id);
        const newSourceRows = [];
        const pendingCandidates = [];

        for (const account of result.accounts || []) {
          const txns = cli.limit ? account.txns.slice(0, cli.limit) : account.txns;
          for (const txn of txns) {
            providerDetail.scraped += 1;
            runStats.total_scraped += 1;

            const transactionIdentifier = String(txn.identifier || fallbackTransactionIdentifier(account.accountNumber, txn));
            const existingSourceId = sourceIdMap.get(transactionIdentifier) || null;

            if (!existingSourceId) {
              newSourceRows.push({
                config_id: config.id,
                transaction_identifier: transactionIdentifier,
                account_number: account.accountNumber || "",
                transaction_date: txn.date || null,
                processed_date: txn.processedDate || txn.date || null,
                original_amount: txn.originalAmount ?? txn.chargedAmount ?? 0,
                original_currency: txn.originalCurrency || "ILS",
                charged_amount: resolveScrapedAmount(txn),
                description: txn.description || "",
                memo: txn.memo || null,
                transaction_type: txn.type || "normal",
                status: txn.status || "completed",
                installment_number: txn.installments?.number ?? null,
                total_installments: txn.installments?.total ?? null,
              });
            }

            pendingCandidates.push({
              accountNumber: account.accountNumber || "",
              transactionIdentifier,
              existingSourceId,
              txn,
            });
          }
        }

        let insertedSources = [];
        if (!cli.dryRun && newSourceRows.length > 0) {
          log(`Inserting source rows for ${provider.key}`, newSourceRows.length);
          for (const rowsChunk of chunk(newSourceRows, 200)) {
            const { data, error } = await supabase
              .from("bank_scraper_transactions")
              .insert(rowsChunk)
              .select("id,transaction_identifier");
            if (error) throw error;
            insertedSources.push(...(data || []));
          }
        } else {
          insertedSources = newSourceRows.map((row, index) => ({
            id: -1 * (index + 1),
            transaction_identifier: row.transaction_identifier,
          }));
        }

        const insertedByIdentifier = new Map([
          ...sourceIdMap.entries(),
          ...insertedSources.map((row) => [row.transaction_identifier, row.id]),
        ]);
        providerDetail.newSources = insertedSources.length;
        runStats.total_new_sources += insertedSources.length;

        const allCandidateSourceIds = pendingCandidates
          .map((candidate) => insertedByIdentifier.get(candidate.transactionIdentifier))
          .filter((value) => value > 0);
        const sourceRowsById = cli.dryRun || allCandidateSourceIds.length === 0
          ? new Map()
          : await loadSourceRowsByIds(supabase, allCandidateSourceIds);
        if (!cli.dryRun && sourceRowsById.size > 0) {
          const sourceUpdates = await syncObservedSourceRows(supabase, pendingCandidates, sourceRowsById);
          if (sourceUpdates > 0) {
            log(`Updated existing source rows for ${provider.key}`, sourceUpdates);
          }
        }
        const ignoredSourceIds = cli.dryRun || allCandidateSourceIds.length === 0
          ? new Set()
          : await loadIgnoredSourceIds(supabase, MAIN_USER_ID, allCandidateSourceIds);
        const existingPendingSet = cli.dryRun || allCandidateSourceIds.length === 0
          ? new Set()
          : await loadExistingPendingSourceIds(supabase, allCandidateSourceIds);

        const pendingRows = [];
        const transactionCandidates = [];
        for (const candidate of pendingCandidates) {
          const sourceId = insertedByIdentifier.get(candidate.transactionIdentifier);
          if (!sourceId) continue;
          if (sourceId > 0 && ignoredSourceIds.has(sourceId)) continue;
          if (isCardSettlementCharge({ provider, txn: candidate.txn })) {
            if (!cli.dryRun && sourceId > 0) {
              await ignoreBankScraperSourceRow(supabase, {
                userId: MAIN_USER_ID,
                sourceId,
                reason: "auto_card_settlement_duplicate",
                notes: `Ignored automated bank-side credit-card settlement charge for ${candidate.txn.description || provider.key}`,
              });
              ignoredSourceIds.add(sourceId);
            }
            continue;
          }
          if (isCardIssuerStatementLike({ provider, txn: candidate.txn })) {
            if (!cli.dryRun && sourceId > 0) {
              await ignoreBankScraperSourceRow(supabase, {
                userId: MAIN_USER_ID,
                sourceId,
                reason: "auto_card_issuer_statement",
                notes: `Ignored card issuer statement row for ${candidate.txn.description || provider.key}`,
              });
              ignoredSourceIds.add(sourceId);
            }
            continue;
          }
          const sourceStatus = String(candidate.txn.status || "completed").toLowerCase();
          if (sourceId > 0 && existingPendingSet.has(sourceId) && (cli.deferClassification || sourceStatus === "pending")) continue;

          const classification = cli.deferClassification
            ? {
                categoryName: DEFAULT_CATEGORY,
                normalizedBusinessName: normalizeMerchantName(candidate.txn.description || provider.key),
                source: "codex_review",
                reasoning: "Category deferred to Codex task after scrape",
              }
            : await classifyMerchant({
                merchantName: candidate.txn.description || provider.key,
                amount: resolveScrapedAmount(candidate.txn),
                paymentMethod: provider.paymentMethod,
                sourceCategory: candidate.txn.memo || null,
                allowedCategories,
                allowedCategorySet,
                memoryMap,
                historicalMap,
                historicalEntries,
                userId: MAIN_USER_ID,
                dryRun: cli.dryRun,
                supabase,
                stats: runStats,
                hasMerchantMemoryTable,
              });

          const paymentDate = candidate.txn.date || candidate.txn.processedDate || null;
          const chargeDate = candidate.txn.processedDate || candidate.txn.date || null;
          const flowMonth = monthFromDate(paymentDate);
          const notes = cli.deferClassification
            ? `${DEFERRED_REVIEW_TAG}${runId ? ` [run:${runId}]` : ""} ${classification.reasoning}`.trim()
            : `[AUTO:${classification.source}] ${classification.reasoning || ""}`.trim();
          const baseRow = {
            user_id: MAIN_USER_ID,
            config_id: config.id,
            business_name: candidate.txn.description || provider.key,
            payment_date: paymentDate,
            charge_date: chargeDate,
            amount: resolveScrapedAmount(candidate.txn),
            currency: "ILS",
            payment_method: provider.paymentMethod,
            payment_identifier: candidate.transactionIdentifier,
            category_name: classification.categoryName,
            payment_month: paymentDate ? Number(String(paymentDate).slice(5, 7)) : null,
            payment_year: paymentDate ? Number(String(paymentDate).slice(0, 4)) : null,
            flow_month: flowMonth,
            notes,
            excluded_from_flow: isNotInFlow(classification.categoryName),
            source_type: "bank_scraper",
            original_amount: candidate.txn.originalAmount ?? candidate.txn.chargedAmount ?? 0,
            transaction_hash: sha1(`${provider.key}|${candidate.accountNumber}|${candidate.transactionIdentifier}`),
            is_transfer: false,
            payment_number: candidate.txn.installments?.number ?? null,
            total_payments: candidate.txn.installments?.total ?? null,
            original_currency: candidate.txn.originalCurrency || "ILS",
            source_category: candidate.txn.memo || null,
            transaction_type: candidate.txn.type || "normal",
            file_source: provider.key,
            bank_scraper_source_id: sourceId > 0 ? sourceId : null,
          };

          if (cli.deferClassification || sourceStatus === "pending") {
            pendingRows.push({
              ...baseRow,
              status: "pending",
            });
            if (sourceId > 0) existingPendingSet.add(sourceId);
          } else {
            transactionCandidates.push({
              row: {
                ...baseRow,
                status: "approved",
                cash_flow_id: MAIN_CASH_FLOW_ID,
              },
              sourceStatus,
              accountNumber: candidate.accountNumber || "",
            });
          }
        }

        if (!cli.dryRun && pendingRows.length > 0) {
          log(`Inserting pending rows for ${provider.key}`, pendingRows.length);
          for (const rowsChunk of chunk(pendingRows, 200)) {
            const { error } = await supabase.from("bank_scraper_pending_transactions").insert(rowsChunk);
            if (error) throw error;
          }
        }

        let insertedTransactionsCount = 0;
        if (!cli.deferClassification) {
          const transactionSourceIds = transactionCandidates.map(({ row }) => row.bank_scraper_source_id).filter((value) => value > 0);
          const transactionHashes = transactionCandidates.map(({ row }) => row.transaction_hash);
          const [existingTransactionSourceIds, existingTransactionHashes] = cli.dryRun || (transactionHashes.length === 0 && transactionSourceIds.length === 0)
            ? [new Set(), new Set()]
            : await Promise.all([
                transactionSourceIds.length > 0 ? loadExistingTransactionSourceIds(supabase, transactionSourceIds) : Promise.resolve(new Set()),
                transactionHashes.length > 0 ? loadExistingTransactionHashes(supabase, transactionHashes) : Promise.resolve(new Set()),
              ]);
          const seenTransactionSourceIds = new Set(existingTransactionSourceIds);
          const seenTransactionHashes = new Set(existingTransactionHashes);
          const seenSplitRepresentationKeys = new Set(existingSplitRepresentationKeys);
          const seenApprovedLooseRepresentationKeys = new Set(existingApprovedLooseRepresentationKeys);
          const replacements = [];
          const transactionsToInsert = transactionCandidates.flatMap(({ row, sourceStatus, accountNumber }) => {
            const lifecycleKey = buildPendingLifecycleIdentityKey({
              configId: row.config_id,
              businessName: row.business_name,
              paymentDate: row.payment_date,
              paymentMethod: row.payment_method,
              paymentNumber: row.payment_number,
              totalPayments: row.total_payments,
              transactionType: row.transaction_type,
            });
            const existingLifecycleRows = existingLifecycleKeys.get(lifecycleKey) || [];
            const strictRepresentationKey = buildTransactionRepresentationKey({
              businessName: row.business_name,
              paymentDate: row.payment_date,
              chargeDate: row.charge_date,
              amount: row.amount,
              paymentMethod: row.payment_method,
            });
            const looseRepresentationKey = buildLooseTransactionRepresentationKey({
              businessName: row.business_name,
              paymentDate: row.payment_date,
              amount: row.amount,
              paymentMethod: row.payment_method,
            });
            if (row.bank_scraper_source_id > 0 && seenTransactionSourceIds.has(row.bank_scraper_source_id)) {
              providerDetail.duplicatesPrevented += 1;
              return [];
            }
            if (seenTransactionHashes.has(row.transaction_hash)) {
              providerDetail.duplicatesPrevented += 1;
              return [];
            }
            if (seenSplitRepresentationKeys.has(strictRepresentationKey)) {
              providerDetail.duplicatesPrevented += 1;
              return [];
            }
            if (seenApprovedLooseRepresentationKeys.has(looseRepresentationKey)) {
              providerDetail.duplicatesPrevented += 1;
              return [];
            }
            if (sourceStatus === "completed") {
              const existingPending = pendingCompletionCandidates.exactMap.get(lifecycleKey)
                || findFuzzyPendingCompletionCandidate(pendingCompletionCandidates.fuzzyCandidates, row, accountNumber);
              if (existingPending && existingPending.bankScraperSourceId !== row.bank_scraper_source_id) {
                replacements.push({
                  existingTransactionId: existingPending.transactionId,
                  replacementRow: row,
                });
                pendingCompletionCandidates.exactMap.delete(lifecycleKey);
                pendingCompletionCandidates.fuzzyCandidates = pendingCompletionCandidates.fuzzyCandidates
                  .filter((candidate) => candidate.transactionId !== existingPending.transactionId);
                existingLifecycleKeys.set(
                  lifecycleKey,
                  existingLifecycleRows.map((candidate) => (
                    candidate.transactionId === existingPending.transactionId
                      ? {
                          transactionId: candidate.transactionId,
                          bankScraperSourceId: row.bank_scraper_source_id,
                          chargeDate: row.charge_date,
                        }
                      : candidate
                  ))
                );
                return [];
              }
            }
            const existingOtherLifecycleRow = existingLifecycleRows.find((candidate) => (
              candidate.bankScraperSourceId !== row.bank_scraper_source_id
              && candidate.chargeDate === row.charge_date
            ));
            if (existingOtherLifecycleRow) {
              return [];
            }
            existingLifecycleRows.push({
              transactionId: row.id || null,
              bankScraperSourceId: row.bank_scraper_source_id,
              chargeDate: row.charge_date,
            });
            existingLifecycleKeys.set(lifecycleKey, existingLifecycleRows);
            if (row.bank_scraper_source_id > 0) seenTransactionSourceIds.add(row.bank_scraper_source_id);
            seenTransactionHashes.add(row.transaction_hash);
            seenSplitRepresentationKeys.add(strictRepresentationKey);
            seenApprovedLooseRepresentationKeys.add(looseRepresentationKey);
            existingApprovedLooseRepresentationKeys.add(looseRepresentationKey);
            return [row];
          });
          if (!cli.dryRun && replacements.length > 0) {
            log(`Resolving pending-to-completed transitions for ${provider.key}`, replacements.length);
            for (const replacement of replacements) {
              const { error } = await supabase
                .from("transactions")
                .update({
                  config_id: replacement.replacementRow.config_id,
                  amount: replacement.replacementRow.amount,
                  payment_date: replacement.replacementRow.payment_date,
                  charge_date: replacement.replacementRow.charge_date,
                  payment_identifier: replacement.replacementRow.payment_identifier,
                  original_amount: replacement.replacementRow.original_amount,
                  original_currency: replacement.replacementRow.original_currency,
                  transaction_type: replacement.replacementRow.transaction_type,
                  payment_number: replacement.replacementRow.payment_number,
                  total_payments: replacement.replacementRow.total_payments,
                  source_category: replacement.replacementRow.source_category,
                  file_source: replacement.replacementRow.file_source,
                  bank_scraper_source_id: replacement.replacementRow.bank_scraper_source_id,
                  transaction_hash: replacement.replacementRow.transaction_hash,
                  payment_month: replacement.replacementRow.payment_month,
                  payment_year: replacement.replacementRow.payment_year,
                  flow_month: replacement.replacementRow.flow_month,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", replacement.existingTransactionId);
              if (error) throw error;
            }
          }
          if (!cli.dryRun) {
            const completedSourceIds = transactionCandidates
              .filter(({ sourceStatus, row }) => sourceStatus === "completed" && row.bank_scraper_source_id > 0)
              .map(({ row }) => row.bank_scraper_source_id);
            if (completedSourceIds.length > 0) {
              const removedPending = await deletePendingRowsBySourceIds(supabase, completedSourceIds);
              if (removedPending.length > 0) {
                log(`Cleared completed pending rows for ${provider.key}`, removedPending.length);
              }
            }
          }
          if (!cli.dryRun && transactionsToInsert.length > 0) {
            log(`Inserting approved transactions for ${provider.key}`, transactionsToInsert.length);
            for (const rowsChunk of chunk(transactionsToInsert, 200)) {
              const { data, error } = await supabase
                .from("transactions")
                .insert(rowsChunk)
                .select("id,business_name,amount,payment_date,category_name,file_source,created_at");
              if (error) throw error;
              insertedTransactionsCount += data?.length || 0;
              insertedReportTransactions.push(...(data || []).map((row) => ({
                ...row,
                provider: provider.key,
              })));
            }
          } else {
            insertedTransactionsCount = transactionsToInsert.length;
            insertedReportTransactions.push(...transactionsToInsert.map((row, index) => ({
              id: `dry-run-${provider.key}-${index + 1}`,
              business_name: row.business_name,
              amount: row.amount,
              payment_date: row.payment_date,
              category_name: row.category_name,
              file_source: row.file_source,
              created_at: new Date().toISOString(),
              provider: provider.key,
            })));
          }
        }

        providerDetail.newTransactions = insertedTransactionsCount;
        runStats.total_new_transactions += insertedTransactionsCount;
        providerDetail.newPending = pendingRows.length;
        runStats.total_new_pending += pendingRows.length;
        runStats.total_duplicates_prevented += providerDetail.duplicatesPrevented;

        if (!cli.dryRun) {
          const finishedAt = new Date();
          await supabase.from("bank_scraper_configs").update({
            last_scrape_date: finishedAt.toISOString(),
            updated_at: finishedAt.toISOString(),
          }).eq("id", config.id);

          await supabase.from("bank_scraper_logs").insert({
            config_id: config.id,
            scrape_date: finishedAt.toISOString().slice(0, 10),
            success: true,
            transactions_count: providerDetail.scraped,
            execution_time_seconds: Math.round((Date.now() - startedAt) / 1000),
          });
        }
      } catch (error) {
        partialFailure = true;
        providerDetail.status = "failed";
        providerDetail.errors.push(formatError(error));
        runStats.total_failed_providers += 1;
        if (!cli.dryRun) {
          await supabase.from("bank_scraper_logs").insert({
            config_id: config.id,
            scrape_date: new Date().toISOString().slice(0, 10),
            success: false,
            error_type: "SYNC_FAILED",
            error_message: providerDetail.errors.join(" | "),
            transactions_count: providerDetail.scraped,
            execution_time_seconds: Math.round((Date.now() - startedAt) / 1000),
          });
        }
      }

      runDetails.push(providerDetail);
    }

    if (!cli.dryRun) {
      const staleRepresentedPendingCleanup = await reconcileStaleRepresentedPendingRows(
        supabase,
        MAIN_USER_ID,
        dedupeLookbackStart,
        existingApprovedLooseRepresentationKeys
      );
      if (staleRepresentedPendingCleanup.length > 0) {
        log("Cleared stale represented pending rows", staleRepresentedPendingCleanup.length);
      }
      pendingDuplicateCleanup = await reconcileDuplicatePendingRows(
        supabase,
        MAIN_USER_ID,
        dedupeLookbackStart
      );
      if (pendingDuplicateCleanup.length > 0) {
        log("Reconciled duplicate pending rows", pendingDuplicateCleanup.length);
      }
      duplicateCleanup = await reconcileRecentPendingCompletedDuplicates(
        supabase,
        MAIN_USER_ID,
        dedupeLookbackStart
      );
      if (duplicateCleanup.length > 0) {
        log("Reconciled duplicate bank scraper rows", duplicateCleanup.length);
      }
      legacyDuplicateCleanup = await reconcileLegacyBankScraperDuplicates(
        supabase,
        MAIN_USER_ID,
        dedupeLookbackStart
      );
      if (legacyDuplicateCleanup.length > 0) {
        log("Reconciled legacy vs bank scraper rows", legacyDuplicateCleanup.length);
      }
    }

    if (!cli.dryRun) {
      try {
        notificationEmail = await sendBrevoReportEmail({
          runStats,
          runDetails,
          partialFailure,
          reportTransactions: insertedReportTransactions,
          runStartedAt,
        });
      } catch (error) {
        notificationEmail = {
          status: "failed",
          reason: formatError(error),
        };
        log("Bank scraper report email failed", notificationEmail.reason);
      }
    } else {
      notificationEmail = { status: "skipped", reason: "Dry run" };
    }

    if (!cli.dryRun && runId && hasSyncRunsTable) {
      const status = partialFailure ? "partial" : "success";
      const { error } = await supabase.from("bank_scraper_sync_runs").update({
        finished_at: new Date().toISOString(),
        status,
        total_scraped: runStats.total_scraped,
        total_new_sources: runStats.total_new_sources,
        total_new_pending: runStats.total_new_pending,
        total_classified_from_memory: runStats.total_classified_from_memory,
        total_classified_from_ai: runStats.total_classified_from_ai,
        total_failed_providers: runStats.total_failed_providers,
        error_summary: partialFailure ? runDetails.filter((detail) => detail.status === "failed").map((detail) => `${detail.provider}: ${detail.errors.join(", ")}`).join(" | ") : null,
        details: {
          providers: runDetails,
          notification_email: notificationEmail,
          pending_duplicate_cleanup: pendingDuplicateCleanup,
          duplicate_cleanup: duplicateCleanup,
          legacy_duplicate_cleanup: legacyDuplicateCleanup,
          inserted_transactions: insertedReportTransactions,
        },
      }).eq("id", runId);
      if (error) throw error;
    }

    log("Bank scraper sync completed");
    console.log(JSON.stringify(buildRunSummary({
      dryRun: cli.dryRun,
      runStats,
      runDetails,
      notificationEmail,
    }), null, 2));
  } catch (error) {
    if (!cli.dryRun && runId && hasSyncRunsTable) {
      await supabase.from("bank_scraper_sync_runs").update({
        finished_at: new Date().toISOString(),
        status: "failed",
        total_scraped: runStats.total_scraped,
        total_new_sources: runStats.total_new_sources,
        total_new_pending: runStats.total_new_pending,
        total_classified_from_memory: runStats.total_classified_from_memory,
        total_classified_from_ai: runStats.total_classified_from_ai,
        total_failed_providers: runStats.total_failed_providers,
        error_summary: error instanceof Error ? error.message : String(error),
        details: {
          providers: runDetails,
          notification_email: notificationEmail,
          pending_duplicate_cleanup: pendingDuplicateCleanup,
          duplicate_cleanup: duplicateCleanup,
          legacy_duplicate_cleanup: legacyDuplicateCleanup,
        },
      }).eq("id", runId);
    }
    throw error;
  }
}

export {
  buildBankScraperReportEmailHtml,
  buildEmailSubject,
  formatCurrency,
  formatDate,
  formatDateTime,
  loadEnv,
  normalizeMerchantName,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
