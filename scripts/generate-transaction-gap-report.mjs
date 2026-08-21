import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

// Point at your own export:  RISEUP_CSV=/path/to/transactions.csv node <script>
const DEFAULT_CSV = process.env.RISEUP_CSV || process.argv[2] || "";
const DEFAULT_OUTPUT = path.resolve("reports/transaction-gaps-2026-06-07.html");
const DEFAULT_MONTHS = ["2026-06", "2026-07"];
const MAIN_CASH_FLOW_ID = "c30c2672-2c39-4599-9e4e-0a536591a438";

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

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }

  return rows;
}

function parseDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return String(value);
  return `${day}.${month}.${year.slice(2)}`;
}

function formatAmount(value) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(Math.abs(Number(value) || 0));
}

function monthLabel(monthKey) {
  const labels = {
    "2026-06": "יוני 2026",
    "2026-07": "יולי 2026",
  };
  return labels[monthKey] ?? monthKey;
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
  return Math.round((intersection / Math.max(left.size, right.size)) * 100);
}

function fuzzyMerchantScore(a, b) {
  return Math.max(similarityRatio(a, b), tokenSetRatio(a, b));
}

function dateDistanceInDays(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const left = new Date(a);
  const right = new Date(b);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(left.getTime() - right.getTime()) / 86400000);
}

function loadCsvEntries(csvPath, months, { includeExcluded = false } = {}) {
  const csvRows = parseCsv(fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF+/u, ""));
  const headers = (csvRows.shift() || []).map((header) => header.replace(/^\uFEFF+/u, "").trim());
  const monthSet = new Set(months);

  return csvRows.flatMap((values, rowIndex) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const flowMonth = row["שייך לתזרים חודש"];
    if (!monthSet.has(flowMonth)) return [];
    const excluded = String(row["האם מוחרג מהתזרים?"]).toLowerCase() === "true";
    if (excluded && !includeExcluded) return [];
    const amount = Number(row["סכום"]);
    if (!row["שם העסק"] || !Number.isFinite(amount)) return [];
    return [{
      side: "csv",
      row_num: rowIndex + 2,
      flow_month: flowMonth,
      business_name: row["שם העסק"],
      normalized_business_name: normalizeMerchantName(row["שם העסק"]),
      amount,
      amount_magnitude: amountMagnitude(amount),
      payment_date: parseDate(row["תאריך התשלום"]),
      charge_date: parseDate(row["תאריך החיוב בחשבון"]),
      category_name: row["קטגוריה בתזרים"] || "",
      payment_method: row["אמצעי התשלום"] || "",
      source_type: row["סוג מקור"] || "",
      excluded_from_flow: excluded,
      notes: row["הערות"] || "",
    }];
  });
}

async function fetchLocalTransactions(months) {
  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SECRET"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("transactions")
    .select("id, flow_month, payment_date, charge_date, business_name, amount, category_name, payment_method, source_type, file_source, status, excluded_from_flow, cash_flow_id")
    .eq("cash_flow_id", MAIN_CASH_FLOW_ID)
    .eq("status", "approved")
    .eq("excluded_from_flow", false)
    .in("flow_month", months)
    .order("flow_month", { ascending: true })
    .order("payment_date", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    side: "db",
    normalized_business_name: normalizeMerchantName(row.business_name),
    amount_magnitude: amountMagnitude(row.amount),
  }));
}

function matchSameMonth(localRows, csvRows) {
  const usedCsvIndexes = new Set();
  const matched = [];
  const localOnly = [];

  for (const localRow of localRows) {
    let best = null;
    for (let index = 0; index < csvRows.length; index += 1) {
      if (usedCsvIndexes.has(index)) continue;
      const csvRow = csvRows[index];
      if (localRow.flow_month !== csvRow.flow_month) continue;
      if (localRow.amount_magnitude !== csvRow.amount_magnitude) continue;

      const exact = localRow.normalized_business_name === csvRow.normalized_business_name;
      const score = exact
        ? 100
        : fuzzyMerchantScore(localRow.normalized_business_name, csvRow.normalized_business_name);
      const containsMatch =
        localRow.normalized_business_name.includes(csvRow.normalized_business_name) ||
        csvRow.normalized_business_name.includes(localRow.normalized_business_name);
      const amountDifference = Math.abs(localRow.amount_magnitude - csvRow.amount_magnitude);
      if (score < 86) continue;

      const localDate = localRow.payment_date || localRow.charge_date;
      const csvDate = csvRow.payment_date || csvRow.charge_date;
      const dateDistance = Math.min(dateDistanceInDays(localDate, csvDate), 30);
      const weightedScore = score - dateDistance + (containsMatch ? 8 : 0);

      if (
        !best ||
        weightedScore > best.weighted_score ||
        (weightedScore === best.weighted_score && dateDistance < best.date_distance)
      ) {
        best = {
          index,
          csvRow,
          match_type: exact ? "exact" : "fuzzy",
          match_score: score,
          date_distance: dateDistance,
          weighted_score: weightedScore,
        };
      }
    }

    if (!best) {
      for (let index = 0; index < csvRows.length; index += 1) {
        if (usedCsvIndexes.has(index)) continue;
        const csvRow = csvRows[index];
        if (localRow.flow_month !== csvRow.flow_month) continue;

        const score = fuzzyMerchantScore(
          localRow.normalized_business_name,
          csvRow.normalized_business_name,
        );
        const containsMatch =
          localRow.normalized_business_name.includes(csvRow.normalized_business_name) ||
          csvRow.normalized_business_name.includes(localRow.normalized_business_name);
        const amountDifference = Math.abs(localRow.amount_magnitude - csvRow.amount_magnitude);
        if (amountDifference > 5) continue;
        if (!(containsMatch || score >= 96)) continue;

        const localDate = localRow.payment_date || localRow.charge_date;
        const csvDate = csvRow.payment_date || csvRow.charge_date;
        const dateDistance = Math.min(dateDistanceInDays(localDate, csvDate), 30);
        if (dateDistance > 3) continue;

        const weightedScore = score - dateDistance - amountDifference + (containsMatch ? 8 : 0);
        if (
          !best ||
          weightedScore > best.weighted_score ||
          (weightedScore === best.weighted_score && dateDistance < best.date_distance)
        ) {
          best = {
            index,
            csvRow,
            match_type: containsMatch ? "fuzzy_contains" : "fuzzy_near_amount",
            match_score: score,
            date_distance: dateDistance,
            weighted_score: weightedScore,
          };
        }
      }
    }

    if (!best) {
      for (let index = 0; index < csvRows.length; index += 1) {
        if (usedCsvIndexes.has(index)) continue;
        const csvRow = csvRows[index];
        if (localRow.flow_month !== csvRow.flow_month) continue;
        if (localRow.amount_magnitude !== csvRow.amount_magnitude) continue;

        const localDate = localRow.payment_date || localRow.charge_date;
        const csvDate = csvRow.payment_date || csvRow.charge_date;
        const dateDistance = Math.min(dateDistanceInDays(localDate, csvDate), 30);
        if (dateDistance > 0) continue;

        const weightedScore = 40 - dateDistance;
        if (!best || weightedScore > best.weighted_score) {
          best = {
            index,
            csvRow,
            match_type: "amount_exact_date_exact",
            match_score: 40,
            date_distance: dateDistance,
            weighted_score: weightedScore,
          };
        }
      }
    }

    if (!best) {
      localOnly.push(localRow);
      continue;
    }

    usedCsvIndexes.add(best.index);
    matched.push({
      local: localRow,
      csv: best.csvRow,
      match_type: best.match_type,
      match_score: best.match_score,
      date_distance: best.date_distance,
    });
  }

  return {
    matched,
    localOnly,
    csvOnly: csvRows.filter((_, index) => !usedCsvIndexes.has(index)),
  };
}

function buildProbablePairs(localOnly, csvOnly) {
  const usedCsvIndexes = new Set();
  const probablePairs = [];
  const remainingLocalOnly = [];

  for (const localRow of localOnly) {
    let best = null;
    for (let index = 0; index < csvOnly.length; index += 1) {
      if (usedCsvIndexes.has(index)) continue;
      const csvRow = csvOnly[index];
      if (localRow.amount_magnitude !== csvRow.amount_magnitude) continue;

      const score = fuzzyMerchantScore(
        localRow.normalized_business_name,
        csvRow.normalized_business_name,
      );
      if (score < 75) continue;

      const localDate = localRow.payment_date || localRow.charge_date;
      const csvDate = csvRow.payment_date || csvRow.charge_date;
      const dateDistance = Math.min(dateDistanceInDays(localDate, csvDate), 30);
      const monthPenalty = localRow.flow_month === csvRow.flow_month ? 0 : 5;
      const weightedScore = score - dateDistance - monthPenalty;

      if (!best || weightedScore > best.weighted_score) {
        best = {
          index,
          csvRow,
          score,
          dateDistance,
          weighted_score: weightedScore,
        };
      }
    }

    if (!best) {
      remainingLocalOnly.push(localRow);
      continue;
    }

    usedCsvIndexes.add(best.index);
    probablePairs.push({
      local: localRow,
      csv: best.csvRow,
      match_score: best.score,
      date_distance: best.dateDistance,
      same_month: localRow.flow_month === best.csvRow.flow_month,
    });
  }

  return {
    probablePairs,
    localOnly: remainingLocalOnly,
    csvOnly: csvOnly.filter((_, index) => !usedCsvIndexes.has(index)),
  };
}

function buildExcludedMatches(localOnly, excludedCsvRows) {
  const usedExcludedIndexes = new Set();
  const excludedMatches = [];
  const remainingLocalOnly = [];

  for (const localRow of localOnly) {
    let best = null;
    for (let index = 0; index < excludedCsvRows.length; index += 1) {
      if (usedExcludedIndexes.has(index)) continue;
      const csvRow = excludedCsvRows[index];
      if (localRow.amount_magnitude !== csvRow.amount_magnitude) continue;

      const score = fuzzyMerchantScore(
        localRow.normalized_business_name,
        csvRow.normalized_business_name,
      );
      const contains =
        localRow.normalized_business_name.includes(csvRow.normalized_business_name) ||
        csvRow.normalized_business_name.includes(localRow.normalized_business_name);
      const localDate = localRow.payment_date || localRow.charge_date;
      const csvDate = csvRow.payment_date || csvRow.charge_date;
      const dateDistance = Math.min(dateDistanceInDays(localDate, csvDate), 30);
      const monthPenalty = localRow.flow_month === csvRow.flow_month ? 0 : 5;
      const weightedScore = score - dateDistance - monthPenalty + (contains ? 8 : 0);
      if (!(contains || score >= 75)) continue;
      if (dateDistance > 7) continue;

      if (!best || weightedScore > best.weighted_score) {
        best = { index, csvRow, score, dateDistance, weighted_score: weightedScore };
      }
    }

    if (!best) {
      remainingLocalOnly.push(localRow);
      continue;
    }

    usedExcludedIndexes.add(best.index);
    excludedMatches.push({
      local: localRow,
      csv: best.csvRow,
      match_score: best.score,
      date_distance: best.dateDistance,
    });
  }

  return {
    excludedMatches,
    localOnly: remainingLocalOnly,
  };
}

function summarizeByMonth(months, localRows, csvRows, matched, localOnly, csvOnly, probablePairs) {
  return months.map((month) => ({
    month,
    month_label: monthLabel(month),
    local_count: localRows.filter((row) => row.flow_month === month).length,
    csv_count: csvRows.filter((row) => row.flow_month === month).length,
    matched_count: matched.filter((row) => row.local.flow_month === month).length,
    local_only_count: localOnly.filter((row) => row.flow_month === month).length,
    csv_only_count: csvOnly.filter((row) => row.flow_month === month).length,
    probable_pair_count: probablePairs.filter(
      (row) => row.local.flow_month === month || row.csv.flow_month === month,
    ).length,
  }));
}

function buildSectionRows(rows, type) {
  if (type === "probable") {
    return rows.map((row) => ({
      section: "probable",
      month: row.local.flow_month,
      month_label: monthLabel(row.local.flow_month),
      business_name: row.local.business_name,
      amount: row.local.amount,
      amount_label: formatAmount(row.local.amount),
      diagnosis: row.same_month
        ? "אותו חודש, אבל שם העסק שונה בין המקורות."
        : "אותה עסקה כמעט בטוח, אבל חודש התזרים שונה בין המקורות.",
      local_date_label: formatDate(row.local.payment_date || row.local.charge_date),
      csv_date_label: formatDate(row.csv.payment_date || row.csv.charge_date),
      local_category: row.local.category_name,
      csv_category: row.csv.category_name,
      local_extra: `${row.local.payment_method || ""} | ${row.local.file_source || ""}`.replace(/^ \| | \| $/g, ""),
      csv_extra: `${row.csv.payment_method || ""} | CSV שורה ${row.csv.row_num}`.replace(/^ \| | \| $/g, ""),
      local_business_name: row.local.business_name,
      csv_business_name: row.csv.business_name,
      match_score: row.match_score,
    }));
  }

  if (type === "excluded_match") {
    return rows.map((row) => ({
      section: "excluded_match",
      month: row.local.flow_month,
      month_label: monthLabel(row.local.flow_month),
      business_name: row.local.business_name,
      amount: row.local.amount,
      amount_label: formatAmount(row.local.amount),
      diagnosis: "יש התאמה בקובץ, אבל השורה בקובץ מוחרגת מהתזרים.",
      local_date_label: formatDate(row.local.payment_date || row.local.charge_date),
      csv_date_label: formatDate(row.csv.payment_date || row.csv.charge_date),
      local_category: row.local.category_name,
      csv_category: row.csv.category_name,
      local_extra: `${row.local.payment_method || ""} | ${row.local.file_source || ""}`.replace(/^ \| | \| $/g, ""),
      csv_extra: `${row.csv.payment_method || ""} | CSV שורה ${row.csv.row_num}`.replace(/^ \| | \| $/g, ""),
      local_business_name: row.local.business_name,
      csv_business_name: row.csv.business_name,
      match_score: row.match_score,
      excluded_note: row.csv.notes || "",
    }));
  }

  return rows.map((row) => ({
    section: type,
    month: row.flow_month,
    month_label: monthLabel(row.flow_month),
    business_name: row.business_name,
    amount: row.amount,
    amount_label: formatAmount(row.amount),
    diagnosis:
      type === "local_only"
        ? "נמצאה אצלך ב־DB ואין לה התאמה בקובץ ה־CSV הלא-מוחרג."
        : "נמצאה בקובץ ה־CSV ואין לה התאמה ב־DB שלך.",
    local_date_label: type === "local_only" ? formatDate(row.payment_date || row.charge_date) : "",
    csv_date_label: type === "csv_only" ? formatDate(row.payment_date || row.charge_date) : "",
    local_category: type === "local_only" ? row.category_name : "",
    csv_category: type === "csv_only" ? row.category_name : "",
    local_extra:
      type === "local_only"
        ? `${row.payment_method || ""} | ${row.file_source || ""}`.replace(/^ \| | \| $/g, "")
        : "",
    csv_extra:
      type === "csv_only"
        ? `${row.payment_method || ""} | CSV שורה ${row.row_num}`.replace(/^ \| | \| $/g, "")
        : "",
    local_business_name: type === "local_only" ? row.business_name : "",
    csv_business_name: type === "csv_only" ? row.business_name : "",
    match_score: null,
  }));
}

function renderTableRows(rows, type) {
  return rows
    .map((row) => {
      if (type === "probable") {
        return [
          "<tr>",
          `<td>${escapeHtml(row.month_label)}</td>`,
          `<td class="amount">${escapeHtml(row.amount_label)}</td>`,
          '<td><div class="merchant">',
          `<strong>${escapeHtml(row.local_business_name)}</strong>`,
          `<small>אצלך | ${escapeHtml(row.local_date_label)} | ${escapeHtml(row.local_category || "-")}</small>`,
          `<small>${escapeHtml(row.local_extra || "")}</small>`,
          "</div></td>",
          '<td><div class="merchant">',
          `<strong>${escapeHtml(row.csv_business_name)}</strong>`,
          `<small>בקובץ | ${escapeHtml(row.csv_date_label)} | ${escapeHtml(row.csv_category || "-")}</small>`,
          `<small>${escapeHtml(row.csv_extra || "")}</small>`,
          "</div></td>",
          `<td>${escapeHtml(String(row.match_score ?? ""))}</td>`,
          `<td class="diagnosis">${escapeHtml(row.diagnosis)}</td>`,
          "</tr>",
        ].join("");
      }

      const dateLabel = type === "local_only" ? row.local_date_label : row.csv_date_label;
      const categoryLabel = type === "local_only" ? row.local_category : row.csv_category;
      const extraLabel = type === "local_only" ? row.local_extra : row.csv_extra;

      return [
        "<tr>",
        `<td>${escapeHtml(row.month_label)}</td>`,
        `<td class="amount">${escapeHtml(row.amount_label)}</td>`,
        '<td><div class="merchant">',
        `<strong>${escapeHtml(row.business_name)}</strong>`,
        `<small>${escapeHtml(dateLabel || "")}</small>`,
        `<small>${escapeHtml(categoryLabel || "-")} | ${escapeHtml(extraLabel || "")}</small>`,
        "</div></td>",
        `<td>${type === "local_only" ? "כן" : "לא"}</td>`,
        `<td>${type === "csv_only" ? "כן" : "לא"}</td>`,
        `<td class="diagnosis">${escapeHtml(row.diagnosis)}</td>`,
        "</tr>",
      ].join("");
    })
    .join("");
}

function buildHtml({ reportRows, monthSummaries, totals }) {
  const dataPayload = reportRows.map((row) => ({
    ...row,
    normalized_business_name: normalizeMerchantName(
      row.business_name || row.local_business_name || row.csv_business_name,
    ),
  }));

  const monthChips = monthSummaries
    .map(
      (summary) =>
        `<div class="chip"><span>${escapeHtml(summary.month_label)}</span><strong>${summary.local_count} / ${summary.csv_count}</strong></div>`,
    )
    .join("");

  const initialRowsHtml = dataPayload
    .map((row) => {
      if (row.section === "probable") {
        return [
          `<tr data-section="${escapeHtml(row.section)}" data-month="${escapeHtml(row.month)}">`,
          `<td><span class="tag probable">כנראה אותה עסקה</span></td>`,
          `<td>${escapeHtml(row.month_label)}</td>`,
          `<td class="amount">${escapeHtml(row.amount_label)}</td>`,
          '<td><div class="merchant">',
          `<strong>${escapeHtml(row.local_business_name)}</strong>`,
          `<small>אצלך | ${escapeHtml(row.local_date_label)} | ${escapeHtml(row.local_category || "-")}</small>`,
          `<small>${escapeHtml(row.local_extra || "")}</small>`,
          "</div></td>",
          '<td><div class="merchant">',
          `<strong>${escapeHtml(row.csv_business_name)}</strong>`,
          `<small>בקובץ | ${escapeHtml(row.csv_date_label)} | ${escapeHtml(row.csv_category || "-")}</small>`,
          `<small>${escapeHtml(row.csv_extra || "")}</small>`,
          "</div></td>",
          `<td>${escapeHtml(String(row.match_score ?? ""))}</td>`,
          `<td class="diagnosis">${escapeHtml(row.diagnosis)}</td>`,
          "</tr>",
        ].join("");
      }

      if (row.section === "excluded_match") {
        return [
          `<tr data-section="${escapeHtml(row.section)}" data-month="${escapeHtml(row.month)}">`,
          `<td><span class="tag excluded-match">יש התאמה מוחרגת</span></td>`,
          `<td>${escapeHtml(row.month_label)}</td>`,
          `<td class="amount">${escapeHtml(row.amount_label)}</td>`,
          '<td><div class="merchant">',
          `<strong>${escapeHtml(row.local_business_name)}</strong>`,
          `<small>אצלך | ${escapeHtml(row.local_date_label)} | ${escapeHtml(row.local_category || "-")}</small>`,
          `<small>${escapeHtml(row.local_extra || "")}</small>`,
          "</div></td>",
          '<td><div class="merchant">',
          `<strong>${escapeHtml(row.csv_business_name)}</strong>`,
          `<small>בקובץ מוחרג | ${escapeHtml(row.csv_date_label)} | ${escapeHtml(row.csv_category || "-")}</small>`,
          `<small>${escapeHtml(row.csv_extra || "")}</small>`,
          row.excluded_note ? `<small>הערה: ${escapeHtml(row.excluded_note)}</small>` : "",
          "</div></td>",
          `<td>${escapeHtml(String(row.match_score ?? ""))}</td>`,
          `<td class="diagnosis">${escapeHtml(row.diagnosis)}</td>`,
          "</tr>",
        ].join("");
      }

      const existsLocal = row.section === "local_only" ? "כן" : "לא";
      const existsCsv = row.section === "csv_only" ? "כן" : "לא";
      const dateLabel = row.section === "local_only" ? row.local_date_label : row.csv_date_label;
      const categoryLabel = row.section === "local_only" ? row.local_category : row.csv_category;
      const extraLabel = row.section === "local_only" ? row.local_extra : row.csv_extra;
      const tagLabel = row.section === "local_only" ? "אצלי בלבד" : "בקובץ בלבד";
      const tagClass = row.section === "local_only" ? "local-only" : "csv-only";

      return [
        `<tr data-section="${escapeHtml(row.section)}" data-month="${escapeHtml(row.month)}">`,
        `<td><span class="tag ${escapeHtml(tagClass)}">${escapeHtml(tagLabel)}</span></td>`,
        `<td>${escapeHtml(row.month_label)}</td>`,
        `<td class="amount">${escapeHtml(row.amount_label)}</td>`,
        '<td><div class="merchant">',
        `<strong>${escapeHtml(row.business_name)}</strong>`,
        `<small>${escapeHtml(dateLabel || "")}</small>`,
        `<small>${escapeHtml(categoryLabel || "-")} | ${escapeHtml(extraLabel || "")}</small>`,
        "</div></td>",
        `<td>${escapeHtml(existsLocal)}</td>`,
        `<td>${escapeHtml(existsCsv)}</td>`,
        `<td class="diagnosis">${escapeHtml(row.diagnosis)}</td>`,
        "</tr>",
      ].join("");
    })
    .join("");

  const monthOptions = [
    '<option value="">כל החודשים</option>',
    ...monthSummaries.map(
      (summary) =>
        `<option value="${escapeHtml(summary.month)}">${escapeHtml(summary.month_label)}</option>`,
    ),
  ].join("");

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>פערי עסקאות מול CSV</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f1ea;
      --card: rgba(255, 255, 255, 0.9);
      --ink: #1d1d1b;
      --muted: #6b655d;
      --line: rgba(29, 29, 27, 0.12);
      --teal: #0f766e;
      --teal-soft: rgba(15, 118, 110, 0.12);
      --amber: #b45309;
      --amber-soft: rgba(180, 83, 9, 0.12);
      --rose: #be123c;
      --rose-soft: rgba(190, 18, 60, 0.12);
      --shadow: 0 24px 60px rgba(71, 56, 39, 0.12);
      --radius: 24px;
      --font: "IBM Plex Sans Hebrew", "Heebo", "Arial", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font);
      background:
        radial-gradient(circle at top right, rgba(15, 118, 110, 0.12), transparent 26%),
        radial-gradient(circle at top left, rgba(180, 83, 9, 0.08), transparent 28%),
        var(--bg);
      color: var(--ink);
    }
    .wrap {
      width: min(1500px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }
    .hero, .panel {
      background: var(--card);
      backdrop-filter: blur(18px);
      border: 1px solid rgba(255, 255, 255, 0.66);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }
    .hero { padding: 28px; margin-bottom: 20px; }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: var(--teal-soft);
      color: var(--teal);
      font-size: 14px;
      font-weight: 700;
    }
    h1 {
      margin: 16px 0 10px;
      font-size: clamp(30px, 4vw, 50px);
      line-height: 0.96;
      letter-spacing: -0.04em;
    }
    .sub {
      margin: 0;
      max-width: 950px;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.6;
    }
    .warning {
      margin-top: 18px;
      padding: 16px 18px;
      border-radius: 18px;
      border: 1px solid rgba(180, 83, 9, 0.2);
      background: var(--amber-soft);
      color: #7c4208;
      line-height: 1.6;
      font-size: 14px;
      font-weight: 600;
    }
    .chips, .stats {
      display: grid;
      gap: 12px;
      margin-top: 20px;
    }
    .chips { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    .stats { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    .chip, .stat {
      border-radius: 18px;
      padding: 16px 18px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.72);
    }
    .chip {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
    }
    .chip span, .stat span {
      color: var(--muted);
      font-size: 14px;
    }
    .chip strong, .stat strong {
      font-size: 28px;
      line-height: 1;
    }
    .panel { padding: 22px; }
    .filters {
      display: grid;
      grid-template-columns: 1.2fr 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    label {
      display: grid;
      gap: 8px;
      font-size: 13px;
      color: var(--muted);
      font-weight: 700;
    }
    select, input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
      font: inherit;
      color: var(--ink);
      background: rgba(255, 255, 255, 0.9);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
      color: var(--muted);
      font-size: 14px;
    }
    .legend {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      border-radius: 999px;
      background: var(--amber-soft);
      color: var(--amber);
      font-weight: 700;
    }
    .table-wrap {
      overflow: auto;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.76);
    }
    table {
      width: 100%;
      min-width: 1220px;
      border-collapse: collapse;
    }
    th, td {
      padding: 16px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      text-align: right;
    }
    th {
      position: sticky;
      top: 0;
      background: rgba(248, 246, 241, 0.96);
      backdrop-filter: blur(12px);
      font-size: 13px;
      color: var(--muted);
      z-index: 1;
    }
    tbody tr:hover { background: rgba(15, 118, 110, 0.05); }
    .merchant {
      display: grid;
      gap: 8px;
    }
    .merchant strong { font-size: 16px; }
    .merchant small {
      color: var(--muted);
      line-height: 1.45;
    }
    .amount {
      font-weight: 800;
      white-space: nowrap;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }
    .tag.local-only { background: var(--rose-soft); color: var(--rose); }
    .tag.csv-only { background: var(--amber-soft); color: var(--amber); }
    .tag.probable { background: var(--teal-soft); color: var(--teal); }
    .tag.excluded-match { background: rgba(59, 130, 246, 0.12); color: #1d4ed8; }
    .diagnosis {
      max-width: 280px;
      line-height: 1.55;
    }
    .empty {
      display: none;
      padding: 32px 16px 12px;
      text-align: center;
      color: var(--muted);
    }
    @media (max-width: 980px) {
      .wrap { width: min(100vw - 20px, 1500px); padding-top: 16px; }
      .hero, .panel { padding: 18px; border-radius: 20px; }
      .filters { grid-template-columns: 1fr; }
      table { min-width: 980px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="eyebrow">DB מול קובץ CSV</div>
      <h1>פערי עסקאות ברמת עסקה</h1>
      <p class="sub">הדוח הזה מראה מה יש אצלך ב־DB ואין בקובץ הלא-מוחרג, מה יש בקובץ ואין אצלך, אילו עסקאות יש להן התאמה מוחרגת בקובץ, ואילו עסקאות כנראה זהות אבל זזו חודש או השתנה להן שם העסק.</p>
      <div class="warning">ההשוואה מבוססת רק על ה־DB המקומי שלך ועל קובץ ה־CSV: אין כאן שימוש ב־RiseUp MCP, באתר RiseUp או בנתונים חיצוניים אחרים.</div>
      <div class="chips">${monthChips}</div>
      <div class="stats">
        <div class="stat"><span>סה״כ אצלך</span><strong>${totals.local_count}</strong></div>
        <div class="stat"><span>סה״כ בקובץ</span><strong>${totals.csv_count}</strong></div>
        <div class="stat"><span>אצלי בלבד</span><strong>${totals.local_only_count}</strong></div>
        <div class="stat"><span>בקובץ בלבד</span><strong>${totals.csv_only_count}</strong></div>
        <div class="stat"><span>התאמה מוחרגת</span><strong>${totals.excluded_match_count}</strong></div>
        <div class="stat"><span>כנראה אותה עסקה</span><strong>${totals.probable_pair_count}</strong></div>
      </div>
    </section>

    <section class="panel">
      <div class="filters">
        <label>סוג פער
          <select id="sectionFilter">
            <option value="">כל הסוגים</option>
            <option value="local_only">אצלי בלבד</option>
            <option value="csv_only">בקובץ בלבד</option>
            <option value="excluded_match">יש התאמה מוחרגת</option>
            <option value="probable">כנראה אותה עסקה</option>
          </select>
        </label>
        <label>חודש
          <select id="monthFilter">${monthOptions}</select>
        </label>
        <label>חיפוש בית עסק
          <input id="merchantFilter" type="search" placeholder="למשל NETFLIX / BUZA / מוניקס" />
        </label>
      </div>

      <div class="meta">
        <div id="resultCount">מוצגות ${dataPayload.length} שורות מתוך ${dataPayload.length}.</div>
        <div class="legend">דוח דו-כיווני: כולל גם שורות מוחרגות בקובץ.</div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>סטטוס</th>
              <th>חודש</th>
              <th>סכום</th>
              <th>אצלך</th>
              <th>בקובץ</th>
              <th>ציון התאמה</th>
              <th>אבחנה</th>
            </tr>
          </thead>
          <tbody id="tableBody">${initialRowsHtml}</tbody>
        </table>
      </div>
      <div class="empty" id="emptyState">אין תוצאות לפילטרים שבחרת.</div>
    </section>
  </div>

  <script>
    const DATA = ${JSON.stringify(dataPayload)};
    const tableBody = document.getElementById("tableBody");
    const resultCount = document.getElementById("resultCount");
    const emptyState = document.getElementById("emptyState");
    const sectionFilter = document.getElementById("sectionFilter");
    const monthFilter = document.getElementById("monthFilter");
    const merchantFilter = document.getElementById("merchantFilter");

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function rowHtml(row) {
      if (row.section === "probable") {
        return [
          "<tr>",
          '<td><span class="tag probable">כנראה אותה עסקה</span></td>',
          "<td>" + escapeHtml(row.month_label) + "</td>",
          '<td class="amount">' + escapeHtml(row.amount_label) + "</td>",
          '<td><div class="merchant">',
          "<strong>" + escapeHtml(row.local_business_name) + "</strong>",
          "<small>אצלך | " + escapeHtml(row.local_date_label) + " | " + escapeHtml(row.local_category || "-") + "</small>",
          "<small>" + escapeHtml(row.local_extra || "") + "</small>",
          "</div></td>",
          '<td><div class="merchant">',
          "<strong>" + escapeHtml(row.csv_business_name) + "</strong>",
          "<small>בקובץ | " + escapeHtml(row.csv_date_label) + " | " + escapeHtml(row.csv_category || "-") + "</small>",
          "<small>" + escapeHtml(row.csv_extra || "") + "</small>",
          "</div></td>",
          "<td>" + escapeHtml(String(row.match_score ?? "")) + "</td>",
          '<td class="diagnosis">' + escapeHtml(row.diagnosis) + "</td>",
          "</tr>",
        ].join("");
      }

      if (row.section === "excluded_match") {
        return [
          "<tr>",
          '<td><span class="tag excluded-match">יש התאמה מוחרגת</span></td>',
          "<td>" + escapeHtml(row.month_label) + "</td>",
          '<td class="amount">' + escapeHtml(row.amount_label) + "</td>",
          '<td><div class="merchant">',
          "<strong>" + escapeHtml(row.local_business_name) + "</strong>",
          "<small>אצלך | " + escapeHtml(row.local_date_label) + " | " + escapeHtml(row.local_category || "-") + "</small>",
          "<small>" + escapeHtml(row.local_extra || "") + "</small>",
          "</div></td>",
          '<td><div class="merchant">',
          "<strong>" + escapeHtml(row.csv_business_name) + "</strong>",
          "<small>בקובץ מוחרג | " + escapeHtml(row.csv_date_label) + " | " + escapeHtml(row.csv_category || "-") + "</small>",
          "<small>" + escapeHtml(row.csv_extra || "") + "</small>",
          (row.excluded_note ? "<small>הערה: " + escapeHtml(row.excluded_note) + "</small>" : ""),
          "</div></td>",
          "<td>" + escapeHtml(String(row.match_score ?? "")) + "</td>",
          '<td class="diagnosis">' + escapeHtml(row.diagnosis) + "</td>",
          "</tr>",
        ].join("");
      }

      const tagLabel = row.section === "local_only" ? "אצלי בלבד" : "בקובץ בלבד";
      const tagClass = row.section === "local_only" ? "local-only" : "csv-only";
      const dateLabel = row.section === "local_only" ? row.local_date_label : row.csv_date_label;
      const categoryLabel = row.section === "local_only" ? row.local_category : row.csv_category;
      const extraLabel = row.section === "local_only" ? row.local_extra : row.csv_extra;
      const existsLocal = row.section === "local_only" ? "כן" : "לא";
      const existsCsv = row.section === "csv_only" ? "כן" : "לא";

      return [
        "<tr>",
        '<td><span class="tag ' + tagClass + '">' + escapeHtml(tagLabel) + "</span></td>",
        "<td>" + escapeHtml(row.month_label) + "</td>",
        '<td class="amount">' + escapeHtml(row.amount_label) + "</td>",
        '<td><div class="merchant">',
        "<strong>" + escapeHtml(row.section === "local_only" ? row.business_name : "לא קיים") + "</strong>",
        "<small>" + escapeHtml(row.section === "local_only" ? dateLabel : "") + "</small>",
        "<small>" + escapeHtml(row.section === "local_only" ? (categoryLabel || "-") + " | " + (extraLabel || "") : "") + "</small>",
        "</div></td>",
        '<td><div class="merchant">',
        "<strong>" + escapeHtml(row.section === "csv_only" ? row.business_name : "לא קיים") + "</strong>",
        "<small>" + escapeHtml(row.section === "csv_only" ? dateLabel : "") + "</small>",
        "<small>" + escapeHtml(row.section === "csv_only" ? (categoryLabel || "-") + " | " + (extraLabel || "") : "") + "</small>",
        "</div></td>",
        "<td>" + escapeHtml(row.match_score == null ? "-" : String(row.match_score)) + "</td>",
        '<td class="diagnosis">' + escapeHtml(row.diagnosis) + "</td>",
        "</tr>",
      ].join("");
    }

    function applyFilters() {
      const section = sectionFilter.value;
      const month = monthFilter.value;
      const merchantQuery = merchantFilter.value.trim().toLowerCase();

      const filtered = DATA.filter((row) => {
        if (section && row.section !== section) return false;
        if (month && row.month !== month) return false;
        if (
          merchantQuery &&
          !String(row.business_name || "").toLowerCase().includes(merchantQuery) &&
          !String(row.local_business_name || "").toLowerCase().includes(merchantQuery) &&
          !String(row.csv_business_name || "").toLowerCase().includes(merchantQuery)
        ) {
          return false;
        }
        return true;
      });

      tableBody.innerHTML = filtered.map(rowHtml).join("");
      emptyState.style.display = filtered.length ? "none" : "block";
      resultCount.textContent = "מוצגות " + filtered.length + " שורות מתוך " + DATA.length + ".";
    }

    [sectionFilter, monthFilter, merchantFilter].forEach((element) =>
      element.addEventListener("input", applyFilters),
    );

    applyFilters();
  </script>
</body>
</html>`;

  return html;
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const csvPath = args.find((value) => value.toLowerCase().endsWith(".csv")) || DEFAULT_CSV;
  const requestedMonths = args.filter((value) => /^\d{4}-\d{2}$/.test(value));
  const months = requestedMonths.length ? requestedMonths : DEFAULT_MONTHS;
  const outputPath =
    args.find((value) => value.toLowerCase().endsWith(".html")) || DEFAULT_OUTPUT;

  const csvRows = loadCsvEntries(csvPath, months);
  const excludedCsvRows = loadCsvEntries(csvPath, months, { includeExcluded: true })
    .filter((row) => row.excluded_from_flow);
  const localRows = await fetchLocalTransactions(months);
  const sameMonthMatch = matchSameMonth(localRows, csvRows);
  const probable = buildProbablePairs(sameMonthMatch.localOnly, sameMonthMatch.csvOnly);
  const excluded = buildExcludedMatches(probable.localOnly, excludedCsvRows);

  const monthSummaries = summarizeByMonth(
    months,
    localRows,
    csvRows,
    sameMonthMatch.matched,
    excluded.localOnly,
    probable.csvOnly,
    probable.probablePairs,
  );

  const reportRows = [
    ...buildSectionRows(excluded.excludedMatches, "excluded_match"),
    ...buildSectionRows(probable.probablePairs, "probable"),
    ...buildSectionRows(excluded.localOnly, "local_only"),
    ...buildSectionRows(probable.csvOnly, "csv_only"),
  ].sort((left, right) => {
    if (left.month !== right.month) return left.month.localeCompare(right.month, "he");
    return Number(right.amount) - Number(left.amount);
  });

  const totals = {
    local_count: localRows.length,
    csv_count: csvRows.length,
    matched_count: sameMonthMatch.matched.length,
    local_only_count: excluded.localOnly.length,
    csv_only_count: probable.csvOnly.length,
    excluded_match_count: excluded.excludedMatches.length,
    probable_pair_count: probable.probablePairs.length,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buildHtml({ reportRows, monthSummaries, totals }), "utf8");

  process.stdout.write(
    JSON.stringify({
      output: outputPath,
      csv: csvPath,
      months,
      ...totals,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
