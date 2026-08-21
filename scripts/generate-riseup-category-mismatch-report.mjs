import fs from "node:fs/promises";
import path from "node:path";

const inputPath = process.argv[2] ?? "/tmp/riseup_category_mismatches.json";
const outputPath =
  process.argv[3] ??
  path.resolve("reports/riseup-category-mismatches-2026-06-07.html");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatAmount(value) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(Math.abs(Number(value) || 0));
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return String(value);
  return `${day}.${month}.${year.slice(2)}`;
}

function monthLabel(monthKey) {
  const labels = {
    "2026-06": "יוני 2026",
    "2026-07": "יולי 2026",
  };
  return labels[monthKey] ?? monthKey;
}

const raw = await fs.readFile(inputPath, "utf8");
const rows = JSON.parse(raw);

const monthCounts = new Map();
const localCategories = new Set();
const riseupCategories = new Set();

for (const row of rows) {
  monthCounts.set(row.flow_month, (monthCounts.get(row.flow_month) ?? 0) + 1);
  localCategories.add(row.local_category);
  riseupCategories.add(row.riseup_category);
}

const orderedMonths = [...monthCounts.keys()].sort();
const orderedLocalCategories = [...localCategories].sort((a, b) =>
  a.localeCompare(b, "he"),
);
const orderedRiseupCategories = [...riseupCategories].sort((a, b) =>
  a.localeCompare(b, "he"),
);

const monthChips = orderedMonths
  .map((monthKey) => {
    const count = monthCounts.get(monthKey) ?? 0;
    return `<div class="chip"><span>${escapeHtml(monthLabel(monthKey))}</span><strong>${count}</strong></div>`;
  })
  .join("");

const monthOptions = [
  `<option value="">כל החודשים</option>`,
  ...orderedMonths.map(
    (monthKey) =>
      `<option value="${escapeHtml(monthKey)}">${escapeHtml(monthLabel(monthKey))}</option>`,
  ),
].join("");

const localCategoryOptions = [
  `<option value="">כל הקטגוריות אצלך</option>`,
  ...orderedLocalCategories.map(
    (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
  ),
].join("");

const riseupCategoryOptions = [
  `<option value="">כל הקטגוריות בקובץ</option>`,
  ...orderedRiseupCategories.map(
    (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
  ),
].join("");

const dataPayload = rows.map((row) => ({
  ...row,
  amount_label: formatAmount(row.amount),
  month_label: monthLabel(row.flow_month),
  payment_date_label: formatDate(row.payment_date),
  charge_date_label: formatDate(row.charge_date),
  matched_date_label: formatDate(row.matched_date),
}));

function diagnosis(row) {
  if (row.local_category === row.riseup_category) return "אין פער.";
  if (row.match_type === "exact")
    return "שם + סכום תאמו בדיוק. סביר שפער אמיתי בטקסונומיה או בסיווג.";
  if (row.match_type === "fuzzy")
    return "התאמה לפי סכום ודמיון בשם בית עסק. לבדוק ידנית אם עסק דומה.";
  return "התאמה חלשה. לבדוק ידנית.";
}

const initialRowsHtml = dataPayload
  .map((row) => {
    const dates = [
      row.payment_date_label ? `תאריך עסקה: ${row.payment_date_label}` : "",
      row.charge_date_label ? `תאריך חיוב: ${row.charge_date_label}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const matched = [
      row.matched_business_name
        ? `התאמה לקובץ: ${row.matched_business_name}`
        : "",
      row.matched_date_label ? `בתאריך ${row.matched_date_label}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    return [
      "<tr>",
      '<td><div class="merchant">',
      `<strong>${escapeHtml(row.business_name)}</strong>`,
      `<small>${escapeHtml(dates)}</small>`,
      matched ? `<small>${escapeHtml(matched)}</small>` : "",
      "</div></td>",
      `<td>${escapeHtml(row.month_label)}</td>`,
      `<td class="amount">${escapeHtml(row.amount_label)}</td>`,
      `<td><span class="pill">${escapeHtml(row.local_category)}</span></td>`,
      `<td><span class="pill">${escapeHtml(row.riseup_category)}</span></td>`,
      `<td>${escapeHtml(row.match_type)} (${escapeHtml(String(row.match_score ?? ""))})</td>`,
      `<td class="diagnosis">${escapeHtml(diagnosis(row))}</td>`,
      "</tr>",
    ].join("");
  })
  .join("");

const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>פערי קטגוריות מול קובץ התזרים</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f1ea;
      --card: rgba(255, 255, 255, 0.88);
      --ink: #1d1d1b;
      --muted: #6b655d;
      --line: rgba(29, 29, 27, 0.12);
      --accent: #0f766e;
      --accent-soft: rgba(15, 118, 110, 0.12);
      --warn: #b45309;
      --warn-soft: rgba(180, 83, 9, 0.12);
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
      width: min(1440px, calc(100vw - 32px));
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
    .hero {
      padding: 28px;
      margin-bottom: 20px;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
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
      max-width: 860px;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.6;
    }
    .chips, .stats {
      display: grid;
      gap: 12px;
      margin-top: 20px;
    }
    .chips {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
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
    .chip span {
      color: var(--muted);
      font-size: 14px;
    }
    .chip strong, .stat strong {
      font-size: 28px;
      line-height: 1;
    }
    .stats {
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    }
    .warning {
      margin-top: 18px;
      padding: 16px 18px;
      border-radius: 18px;
      border: 1px solid rgba(180, 83, 9, 0.2);
      background: var(--warn-soft);
      color: #7c4208;
      line-height: 1.6;
      font-size: 14px;
      font-weight: 600;
    }
    .stat span {
      display: block;
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 14px;
    }
    .panel {
      padding: 22px;
    }
    .filters {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
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
      background: var(--warn-soft);
      color: var(--warn);
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
      min-width: 1120px;
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
    tbody tr:hover {
      background: rgba(15, 118, 110, 0.05);
    }
    .merchant {
      display: grid;
      gap: 8px;
    }
    .merchant strong {
      font-size: 16px;
    }
    .merchant small, .note {
      color: var(--muted);
      line-height: 1.45;
    }
    .amount {
      font-weight: 800;
      white-space: nowrap;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 12px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }
    .diagnosis {
      max-width: 260px;
      line-height: 1.55;
    }
    .empty {
      display: none;
      padding: 32px 16px 12px;
      text-align: center;
      color: var(--muted);
    }
    @media (max-width: 980px) {
      .wrap { width: min(100vw - 20px, 1440px); padding-top: 16px; }
      .hero, .panel { padding: 18px; border-radius: 20px; }
      .filters { grid-template-columns: 1fr; }
      table { min-width: 960px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="eyebrow">קובץ התזרים מול Budget Lens</div>
      <h1>פערי קטגוריות ברמת עסקה</h1>
      <p class="sub">דוח זה מציג עסקאות שבהן הקטגוריה אצלך שונה מהשדה <code>קטגוריה בתזרים</code> בקובץ ה־CSV שייצאת, עבור יוני ויולי 2026.</p>
      <div class="warning">ההשוואה מבוססת רק על קובץ ה־CSV המקומי. אין בדוח שימוש ב־RiseUp MCP, באתר RiseUp או בנתונים שמורים מה־MCP.</div>
      <div class="chips">${monthChips}</div>
      <div class="stats">
        <div class="stat"><span>סה״כ פערים</span><strong>${rows.length}</strong></div>
        <div class="stat"><span>חודשים</span><strong>${orderedMonths.length}</strong></div>
        <div class="stat"><span>קטגוריות אצלך</span><strong>${orderedLocalCategories.length}</strong></div>
        <div class="stat"><span>קטגוריות בקובץ</span><strong>${orderedRiseupCategories.length}</strong></div>
      </div>
    </section>

    <section class="panel">
      <div class="filters">
        <label>חודש
          <select id="monthFilter">${monthOptions}</select>
        </label>
        <label>הקטגוריה אצלך
          <select id="localCategoryFilter">${localCategoryOptions}</select>
        </label>
        <label>קטגוריה בקובץ
          <select id="riseupCategoryFilter">${riseupCategoryOptions}</select>
        </label>
        <label>חיפוש בית עסק
          <input id="merchantFilter" type="search" placeholder="למשל EL AL / BUZA / גפניקה" />
        </label>
      </div>

      <div class="meta">
        <div id="resultCount">מוצגות ${rows.length} עסקאות מתוך ${rows.length} פערים.</div>
        <div class="legend">פער קטגוריה בלבד. לא כל העסקאות.</div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>עסקה</th>
              <th>חודש</th>
              <th>סכום</th>
              <th>הקטגוריה אצלך</th>
              <th>קטגוריה בקובץ</th>
              <th>סוג התאמה</th>
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
    const monthFilter = document.getElementById("monthFilter");
    const localCategoryFilter = document.getElementById("localCategoryFilter");
    const riseupCategoryFilter = document.getElementById("riseupCategoryFilter");
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
      const dates = [
        row.payment_date_label ? "תאריך עסקה: " + row.payment_date_label : "",
        row.charge_date_label ? "תאריך חיוב: " + row.charge_date_label : "",
      ].filter(Boolean).join(" | ");

      const matched = [
        row.matched_business_name ? "התאמה לקובץ: " + row.matched_business_name : "",
        row.matched_date_label ? "בתאריך " + row.matched_date_label : "",
      ].filter(Boolean).join(" | ");

      return [
        "<tr>",
        '<td><div class="merchant">',
        "<strong>" + escapeHtml(row.business_name) + "</strong>",
        "<small>" + escapeHtml(dates) + "</small>",
        matched ? '<small>' + escapeHtml(matched) + "</small>" : "",
        "</div></td>",
        "<td>" + escapeHtml(row.month_label) + "</td>",
        '<td class="amount">' + escapeHtml(row.amount_label) + "</td>",
        "<td><span class=\"pill\">" + escapeHtml(row.local_category) + "</span></td>",
        "<td><span class=\"pill\">" + escapeHtml(row.riseup_category) + "</span></td>",
        "<td>" + escapeHtml(row.match_type) + " (" + escapeHtml(String(row.match_score ?? "")) + ")</td>",
        '<td class="diagnosis">' + escapeHtml(diagnosis(row)) + "</td>",
        "</tr>",
      ].join("");
    }

    function applyFilters() {
      const month = monthFilter.value;
      const localCategory = localCategoryFilter.value;
      const riseupCategory = riseupCategoryFilter.value;
      const merchantQuery = merchantFilter.value.trim().toLowerCase();

      const filtered = DATA.filter((row) => {
        if (month && row.flow_month !== month) return false;
        if (localCategory && row.local_category !== localCategory) return false;
        if (riseupCategory && row.riseup_category !== riseupCategory) return false;
        if (
          merchantQuery &&
          !String(row.business_name || "").toLowerCase().includes(merchantQuery) &&
          !String(row.matched_business_name || "").toLowerCase().includes(merchantQuery)
        ) {
          return false;
        }
        return true;
      });

      tableBody.innerHTML = filtered.map(rowHtml).join("");
      emptyState.style.display = filtered.length ? "none" : "block";
      resultCount.textContent = "מוצגות " + filtered.length + " עסקאות מתוך " + DATA.length + " פערים.";
    }

    [monthFilter, localCategoryFilter, riseupCategoryFilter, merchantFilter]
      .forEach((element) => element.addEventListener("input", applyFilters));

    applyFilters();
  </script>
</body>
</html>
`;

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, html, "utf8");

console.log(outputPath);
