import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

function readEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  const out: Record<string, string> = {};
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    out[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^["']|["']$/g, "");
  }
  return out;
}

function cleanHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim();
}

function cleanValue(value: string | undefined) {
  const trimmed = (value || "").trim();
  return trimmed === "" || trimmed === "NaN" ? null : trimmed;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
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

function parseDate(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return value;
  const [, d, m, y] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseNumber(value: string | null) {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseBoolean(value: string | null) {
  return (value || "").toLowerCase() === "true";
}

function stableHash(parts: Array<string | number | null | undefined>) {
  let hash = 2166136261;
  const text = parts.map((part) => part ?? "").join("|");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `csv_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function mapCsvRows(text: string) {
  const MAIN_CASH_FLOW_ID = "c30c2672-2c39-4599-9e4e-0a536591a438";
  const MAIN_USER_ID = "e3f6919b-d83b-4456-8325-676550a4382d";
  const hashOccurrences = new Map<string, number>();
  return parseCsv(text).map((row, index) => {
    const flowMonth = cleanValue(row["שייך לתזרים חודש"]);
    const paymentDate = parseDate(cleanValue(row["תאריך התשלום"]));
    const chargeDate = parseDate(cleanValue(row["תאריך החיוב בחשבון"]));
    const amount = parseNumber(cleanValue(row["סכום"]));
    if (!flowMonth || !/^\d{4}-\d{2}$/.test(flowMonth)) throw new Error(`שורה ${index + 2}: חסר חודש תזרים תקין`);
    if (amount === null) throw new Error(`שורה ${index + 2}: חסר סכום תקין`);
    const [paymentYear, paymentMonth] = (paymentDate || "").split("-").map(Number);
    const businessName = cleanValue(row["שם העסק"]);
    const paymentMethod = cleanValue(row["אמצעי התשלום"]);
    const paymentIdentifier = cleanValue(row["אמצעי זיהוי התשלום"]);
    const categoryName = cleanValue(row["קטגוריה בתזרים"]);
    const notes = cleanValue(row["הערות"]);
    const sourceType = cleanValue(row["סוג מקור"]);
    const baseTransactionHash = stableHash([MAIN_USER_ID, MAIN_CASH_FLOW_ID, flowMonth, paymentDate, chargeDate, businessName, paymentMethod, paymentIdentifier, amount, categoryName, notes]);
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
      excluded_from_flow: parseBoolean(cleanValue(row["האם מוחרג מהתזרים?"])),
      source_type: sourceType,
      original_amount: parseNumber(cleanValue(row["סכום מקורי"])),
      transaction_hash: transactionHash,
      cash_flow_id: MAIN_CASH_FLOW_ID,
      category_name: categoryName,
      payment_number: parseNumber(cleanValue(row["מספר התשלום"])),
      total_payments: parseNumber(cleanValue(row["מספר תשלומים כולל"])),
      status: "approved",
    };
  });
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png", "og-image.png"],
      manifest: {
        name: "Budget Lens - ניהול תקציב חכם",
        short_name: "Budget Lens",
        description: "אפליקציה חכמה לניהול תקציב, מעקב הוצאות וניתוח פיננסי.",
        lang: "he",
        dir: "rtl",
        start_url: "/",
        display: "standalone",
        theme_color: "#3b6fb6",
        background_color: "#f8f9fc",
        icons: [
          { src: "/favicon.png", sizes: "192x192", type: "image/png" },
          { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        ],
      },
      workbox: { skipWaiting: true, clientsClaim: true, navigateFallback: "/index.html" },
    }),
    mode === "development" &&
      {
        name: "riseup-import-api",
        configureServer(server: any) {
          const env = {
            ...readEnvFile(".env.supabase.local"),
            ...readEnvFile(".env"),
          };
          const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
          const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET;
          if (!supabaseUrl || !serviceRoleKey) return;
          const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

          server.middlewares.use("/api/import-transactions-csv", async (req: any, res: any, next: any) => {
            if (req.method !== "POST") return next();
            try {
              const chunks: Buffer[] = [];
              for await (const chunk of req) chunks.push(Buffer.from(chunk));
              const body = Buffer.concat(chunks).toString("utf8");
              const payload = body ? JSON.parse(body) : {};
              const text = typeof payload?.text === "string" ? payload.text : "";
              if (!text.trim()) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "CSV text is required" }));
                return;
              }
              const rows = mapCsvRows(text);
              const hashes = rows.map((row) => row.transaction_hash);
              const { data: existing, error: existingError } = await supabase.from("transactions").select("transaction_hash").in("transaction_hash", hashes);
              if (existingError) throw existingError;
              const existingHashes = new Set((existing || []).map((row: any) => row.transaction_hash));
              const seen = new Set(existingHashes);
              const toInsert = rows.filter((row) => {
                if (seen.has(row.transaction_hash)) return false;
                seen.add(row.transaction_hash);
                return true;
              });
              const insertedRows: any[] = [];
              for (let i = 0; i < toInsert.length; i += 250) {
                const chunk = toInsert.slice(i, i + 250);
              const { data, error } = await supabase.from("transactions").insert(chunk).select("id,user_id,business_name,payment_date,charge_date,amount,currency,payment_method,flow_month,notes,excluded_from_flow,category_name,source_category,status,cash_flow_id");
                if (error) throw error;
                if (data) insertedRows.push(...data);
              }
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ parsed: rows.length, inserted: insertedRows.length, skipped: rows.length - insertedRows.length, rows: insertedRows, months: [...new Set(rows.map((row) => row.flow_month))].sort() }));
            } catch (error: any) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: error?.message || "Import failed" }));
            }
          });

          server.middlewares.use("/api/delete-transactions-months", async (req: any, res: any, next: any) => {
            if (req.method !== "POST") return next();
            try {
              const chunks: Buffer[] = [];
              for await (const chunk of req) chunks.push(Buffer.from(chunk));
              const body = Buffer.concat(chunks).toString("utf8");
              const payload = body ? JSON.parse(body) : {};
              const months = Array.isArray(payload?.months) ? payload.months.map((m: unknown) => String(m)).filter((m: string) => /^\d{4}-\d{2}$/.test(m)) : [];
              if (!months.length) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "months is required" }));
                return;
              }
              const { data, error } = await supabase.from("transactions").delete().in("flow_month", months).select("id");
              if (error) throw error;
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ deleted: data?.length || 0, months }));
            } catch (error: any) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: error?.message || "Delete failed" }));
            }
          });

          server.middlewares.use("/api/delete-transaction", async (req: any, res: any, next: any) => {
            if (req.method !== "POST") return next();
            try {
              const chunks: Buffer[] = [];
              for await (const chunk of req) chunks.push(Buffer.from(chunk));
              const body = Buffer.concat(chunks).toString("utf8");
              const payload = body ? JSON.parse(body) : {};
              const id = typeof payload?.id === "string" ? payload.id : "";
              if (!id) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "transaction id is required" }));
                return;
              }

              const { data: transaction, error: fetchError } = await supabase
                .from("transactions")
                .select("id,user_id,business_name,bank_scraper_source_id,source_type")
                .eq("id", id)
                .maybeSingle();
              if (fetchError) throw fetchError;
              if (!transaction) {
                res.statusCode = 404;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Transaction not found" }));
                return;
              }

              let ignored = false;
              if (transaction.bank_scraper_source_id) {
                const { error: ignoreError } = await supabase
                  .from("bank_scraper_ignored_transactions")
                  .upsert({
                    user_id: transaction.user_id,
                    bank_scraper_source_id: transaction.bank_scraper_source_id,
                    reason: "user_deleted",
                    notes: transaction.business_name || null,
                  }, { onConflict: "user_id,bank_scraper_source_id" });
                if (ignoreError) throw ignoreError;
                ignored = true;
              }

              const { data: deleted, error: deleteError } = await supabase
                .from("transactions")
                .delete()
                .eq("id", id)
                .select("id");
              if (deleteError) throw deleteError;

              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ deleted: deleted?.length || 0, ignored }));
            } catch (error: any) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: error?.message || "Delete transaction failed" }));
            }
          });
        },
      },
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
