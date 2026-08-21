import { supabase } from "@/integrations/supabase/client";
import { CATEGORY_ORDER, SHARED_TARGETS, MAIN_CASH_FLOW_ID } from "./configSnapshot";

export type Txn = {
  id: string;
  user_id: string | null;
  config_id?: number | null;
  business_name: string | null;
  payment_date: string | null;
  charge_date: string | null;
  amount: number;
  currency: string | null;
  payment_method: string | null;
  flow_month: string | null;
  notes: string | null;
  excluded_from_flow: boolean | null;
  category_name: string | null;
  source_category: string | null;
  status: string | null;
  cash_flow_id: string | null;
  source_type?: string | null;
  file_source?: string | null;
  bank_scraper_source_id?: number | null;
  normalized_amount?: number | null;
  original_amount?: number | null;
  original_currency?: string | null;
  transaction_type?: string | null;
  transaction_hash?: string | null;
  payment_number?: number | null;
  total_payments?: number | null;
};

export type Category = {
  id: string;
  name: string;
  category_type: string | null;
  color: string | null;
  icon: string | null;
};

export type CashFlow = {
  id: string;
  user_id: string;
  name: string;
  is_default: boolean | null;
  is_monthly: boolean | null;
  is_investment_account: boolean | null;
  created_at: string | null;
};

export type CategoryOrder = {
  id: string;
  user_id: string;
  category_name: string;
  display_order: number | null;
  shared_category: string | null;
  weekly_display: boolean | null;
  monthly_target: number | null;
  use_shared_target: boolean | null;
};

export type SharedCategoryTarget = {
  id: string;
  user_id: string;
  shared_category_name: string;
  monthly_target: number | null;
  weekly_display: boolean | null;
};

// A forecast set for one category in one month. Riseup plans per month rather than once
// globally, so a one-off (a trip, a gift) stops being budgeted the following month.
export type MonthlyTarget = {
  id: string;
  user_id: string;
  cash_flow_id: string;
  category_name: string;
  flow_month: string;
  amount: number;
  is_suggestion: boolean;
};

// Budget Lens brand palette
export const RISE = {
  yellow: "#3C71C5",
  yellowSoft: "#EBF1FA",
  yellowText: "#2C589E",
  blue: "#3C71C5",
  blueSoft: "#EBF1FA",
  blueDark: "#1F4685",
  green: "#00C070",
  greenSoft: "#E8F4BA",
  greenDark: "#205441",
  orange: "#FF7E14",
  orangeSoft: "#FFE0C2",
  pink: "#F34F8A",
  pinkSoft: "#FAD9E5",
  ink: "#202125",
  gray: "#8E8C8C",
  grayLine: "#E8E6E3",
  cream: "#F8F9FC",
  // backdrop the whole app-frame floats on — same blue family as `cream`,
  // just deep enough that the white frame separates from it
  pageBg: "#E6EDF9",
  cardGray: "#FAFAFA",
};

export const NOT_FLOW = ["הוצאות לא תזרימיות", "הכנסות לא תזרימיות"];

// "היעד החודשי" — how much to leave untouched at the end of the month. It comes off the
// top before anything is budgeted. Used when the month has no stored goal.
export const MONTHLY_GOAL = 10;

export type MonthlyGoal = {
  id: string;
  user_id: string;
  cash_flow_id: string | null;
  year: number;
  month: number;
  amount: number;
};

export type TransactionSplitInput = {
  amount: number;
  category_name: string;
  notes?: string | null;
};

// Cash flow vs not-in-flow is driven ENTIRELY by the category name in this data
// (the excluded_from_flow flag is unused/always false). Income vs expense is also
// category-based, not amount-sign-based (refunds can be positive expenses).
export function isNotInFlow(t: Txn) {
  if (t.excluded_from_flow) return true;
  return (t.category_name || "").includes("לא תזרימי");
}

export function isIncome(t: Txn) {
  return (t.category_name || "").startsWith("הכנס") && !isNotInFlow(t);
}

export function primaryCashFlow(txns: Txn[], cashFlows: CashFlow[] = []): string | null {
  // Deterministic: the known main flow ("תזרים ראשי") if it appears in the data.
  if (txns.some((t) => t.cash_flow_id === MAIN_CASH_FLOW_ID)) return MAIN_CASH_FLOW_ID;

  const defaultMain = cashFlows.find(
    (cf) => cf.is_default && cf.is_monthly !== false && !cf.is_investment_account
  );
  if (defaultMain) return defaultMain.id;

  const namedMain = cashFlows.find(
    (cf) => cf.name === "תזרים ראשי" && cf.is_monthly !== false && !cf.is_investment_account
  );
  if (namedMain) return namedMain.id;

  const counts = new Map<string, number>();
  for (const t of txns) {
    if (!t.cash_flow_id) continue;
    counts.set(t.cash_flow_id, (counts.get(t.cash_flow_id) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = -1;
  for (const [cf, n] of counts) if (n > bestN) { bestN = n; best = cf; }
  return best;
}

export type CategoryGroup = {
  name: string;
  color: string;
  type: string; // variable_expense | fixed_expense | income | savings
  spent: number; // absolute value
  expected: number; // configured monthly target, falling back to current spent where needed
  displayOrder: number;
  weeklyDisplay: boolean;
  sharedCategory: string | null;
  txns: Txn[];
};

export type MonthModel = {
  month: string;
  months: string[];
  userId: string | null; // owner of the main cash flow — needed to write plan rows
  cashFlowId: string | null;
  income: { got: number; expected: number; fixed: CategoryGroup[]; variable: CategoryGroup[] };
  variableBucket: CategoryGroup; // generic "הוצאות משתנות"
  trackedVariable: CategoryGroup[]; // named variable categories
  fixed: { total: number; expected: number; groups: CategoryGroup[] };
  savings: { total: number; expected: number; groups: CategoryGroup[] };
  totalSpent: number;
  totalExpected: number;
  monthlyGoal: number;
  netPlan: number; // income - goal - fixed - savings - tracked; negative = planned shortfall
  deficit: number; // 0 when the month is in the black, otherwise the running shortfall
  notInFlow: { incomeTotal: number; expenseTotal: number; incomeTxns: Txn[]; expenseTxns: Txn[] };
};

const abs = (n: number) => Math.abs(n);
const signed = (n: number) => Number(n) || 0;

export async function loadAll(): Promise<{
  txns: Txn[];
  cats: Category[];
  cashFlows: CashFlow[];
  categoryOrder: CategoryOrder[];
  sharedTargets: SharedCategoryTarget[];
  monthlyTargets: MonthlyTarget[];
  monthlyGoals: MonthlyGoal[];
}> {
  const db = supabase as any; // generated types predate transactions/categories tables
  const [txns, cRes, cfRes, coRes, stRes, mtRes, mgRes] = await Promise.all([
    loadAllTransactions(db),
    db.from("categories").select("id,name,category_type,color,icon").limit(2000),
    db.from("cash_flows").select("id,user_id,name,is_default,is_monthly,is_investment_account,created_at").order("created_at", { ascending: true }).limit(100),
    db.from("category_order").select("id,user_id,category_name,display_order,shared_category,weekly_display,monthly_target,use_shared_target").order("display_order", { ascending: true }).limit(500),
    db.from("shared_category_targets").select("id,user_id,shared_category_name,monthly_target,weekly_display").limit(200),
    db.from("monthly_category_targets").select("id,user_id,cash_flow_id,category_name,flow_month,amount,is_suggestion").eq("cash_flow_id", MAIN_CASH_FLOW_ID).limit(5000),
    db.from("monthly_goals").select("id,user_id,cash_flow_id,year,month,amount").limit(500),
  ]);
  if (cRes.error) throw cRes.error;
  if (cfRes.error) throw cfRes.error;
  if (coRes.error) throw coRes.error;
  if (stRes.error) throw stRes.error;
  return {
    txns,
    cats: (cRes.data || []) as Category[],
    cashFlows: (cfRes.data || []) as CashFlow[],
    categoryOrder: (coRes.data || []) as CategoryOrder[],
    sharedTargets: (stRes.data || []) as SharedCategoryTarget[],
    // Tolerated as empty if the migration hasn't run yet — the app falls back to the
    // global category_order targets in that case.
    monthlyTargets: (mtRes.error ? [] : (mtRes.data || [])) as MonthlyTarget[],
    monthlyGoals: (mgRes.error ? [] : (mgRes.data || [])) as MonthlyGoal[],
  };
}

/** Store "היעד החודשי" for a month — how much to keep aside at month end. */
export async function saveMonthlyGoal(userId: string, cashFlowId: string, month: string, amount: number): Promise<void> {
  const db = supabase as any;
  const [year, mm] = month.split("-").map(Number);
  const existing = await db
    .from("monthly_goals")
    .select("id")
    .eq("user_id", userId)
    .eq("cash_flow_id", cashFlowId)
    .eq("year", year)
    .eq("month", mm)
    .maybeSingle();
  const { error } = existing.data?.id
    ? await db.from("monthly_goals").update({ amount }).eq("id", existing.data.id)
    : await db.from("monthly_goals").insert({ user_id: userId, cash_flow_id: cashFlowId, year, month: mm, amount });
  if (error) throw error;
}

/** Move a transaction to another flow month (Riseup allows the previous or current one). */
export async function moveTransactionToMonth(id: string, flowMonth: string): Promise<void> {
  await updateTransaction(id, { flow_month: flowMonth });
}

/** Start tracking a category: it gets its own card and its own slice of the budget. */
export async function addTrackedCategory(userId: string, categoryName: string, displayOrder: number): Promise<void> {
  const db = supabase as any;
  const { error } = await db
    .from("category_order")
    .upsert(
      { user_id: userId, category_name: categoryName, display_order: displayOrder, shared_category: null, use_shared_target: false, weekly_display: false, monthly_target: null },
      { onConflict: "user_id,category_name" }
    );
  if (error) throw error;
}

/** The month's transactions as a CSV, matching what the cards show. */
export function exportMonthCsv(model: MonthModel): string {
  const rows: string[][] = [["תאריך", "עסק", "סכום", "קטגוריה", "אמצעי תשלום", "בתזרים"]];
  const push = (t: Txn, inFlow: boolean) =>
    rows.push([
      t.payment_date || t.charge_date || "",
      (t.business_name || "").replace(/"/g, '""'),
      String(Math.abs(Number(t.amount) || 0)),
      t.category_name || "",
      t.payment_method || "",
      inFlow ? "כן" : "לא",
    ]);

  for (const t of model.variableBucket.txns) push(t, true);
  for (const g of model.trackedVariable) for (const t of g.txns) push(t, true);
  for (const g of [...model.fixed.groups, ...model.savings.groups, ...model.income.fixed, ...model.income.variable]) for (const t of g.txns) push(t, true);
  for (const t of [...model.notInFlow.incomeTxns, ...model.notInFlow.expenseTxns]) push(t, false);

  // BOM so Excel opens the Hebrew columns in UTF-8 rather than mojibake.
  return "﻿" + rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
}

// Write one category's forecast for one month. Always stored as a deliberate choice, so
// the monthly rollover leaves it alone.
export async function saveMonthlyTarget(
  userId: string,
  cashFlowId: string,
  flowMonth: string,
  categoryName: string,
  amount: number
): Promise<void> {
  const db = supabase as any;
  const { error } = await db
    .from("monthly_category_targets")
    .upsert(
      { user_id: userId, cash_flow_id: cashFlowId, flow_month: flowMonth, category_name: categoryName, amount, is_suggestion: false },
      { onConflict: "user_id,cash_flow_id,category_name,flow_month" }
    );
  if (error) throw error;
}

// Riseup models a single cash flow. This account has several historic ones, and only the
// main one ("תזרים ראשי") is in scope — the others would otherwise mix into every total.
async function loadAllTransactions(db: any): Promise<Txn[]> {
  // Self-heal: ensure any orphaned transactions with null cash_flow_id get assigned MAIN_CASH_FLOW_ID and MAIN_USER_ID
  try {
    await db.from("transactions").update({ cash_flow_id: MAIN_CASH_FLOW_ID, user_id: MAIN_USER_ID }).is("cash_flow_id", null);
  } catch {
    // Ignore error if RLS or query fails
  }

  const pageSize = 1000;
  const out: Txn[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const res = await db
      .from("transactions")
      .select("id,user_id,config_id,business_name,payment_date,charge_date,amount,currency,payment_method,flow_month,notes,excluded_from_flow,category_name,source_category,status,cash_flow_id,source_type,file_source,bank_scraper_source_id,normalized_amount,original_amount,original_currency,transaction_type,transaction_hash,payment_number,total_payments")
      .eq("cash_flow_id", MAIN_CASH_FLOW_ID)
      .order("flow_month", { ascending: false })
      .order("payment_date", { ascending: false })
      .range(from, to);
    if (res.error) throw res.error;
    const rows = (res.data || []) as Txn[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

export async function updateTransaction(id: string, patch: Partial<Txn>): Promise<void> {
  const db = supabase as any;
  const { error } = await db.from("transactions").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTransaction(id: string): Promise<{ deleted: number; ignored: boolean }> {
  const response = await fetch("/api/delete-transaction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "מחיקת הרשומה נכשלה");
  }
  return payload;
}

export function isSplitTxn(txn: Txn): boolean {
  if (!txn.notes) return false;
  return txn.notes.includes("[SPLIT") || txn.notes.includes("פוצל מעסקה מקורית:");
}

// Returns the original (pre-split) transaction amount for a split part, or null
export function splitOriginalAmount(txn: Txn): number | null {
  const match = txn.notes?.match(/\[SPLIT:([^:]+):([^:]+):([^:]*):([^\]]*)\]/);
  if (!match) return null;
  const amount = Number(match[2]);
  return Number.isFinite(amount) ? amount : null;
}

// Split a transaction into multiple smaller transactions and delete the original
export async function splitTransaction(originalTxn: Txn, splits: TransactionSplitInput[]): Promise<void> {
  const db = supabase as any;
  const groupId = `split_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const cleanNotes = (originalTxn.notes || "").replace(/\[SPLIT:[^\]]+\]/g, "").trim();
  const splitMeta = `[SPLIT:${groupId}:${Math.abs(originalTxn.amount)}:${originalTxn.category_name || ""}:${encodeURIComponent(cleanNotes)}]`;

  const newTxns = splits.map((s, idx) => {
    const noteParts = [];
    if (cleanNotes) noteParts.push(`הערת מקור: ${cleanNotes}`);
    if (s.notes?.trim()) noteParts.push(`הערת פיצול: ${s.notes.trim()}`);
    noteParts.push(`${splitMeta} פוצל מעסקה מקורית: ${originalTxn.business_name} | חלק ${idx + 1} מתוך ${splits.length}`);

    return {
      user_id: originalTxn.user_id || MAIN_USER_ID,
      config_id: originalTxn.config_id || null,
      business_name: originalTxn.business_name,
      payment_date: originalTxn.payment_date,
      charge_date: originalTxn.charge_date,
      amount: s.amount,
      currency: originalTxn.currency || "ILS",
      payment_method: originalTxn.payment_method,
      flow_month: originalTxn.flow_month,
      excluded_from_flow: originalTxn.excluded_from_flow,
      category_name: s.category_name,
      source_category: originalTxn.source_category,
      status: originalTxn.status || "approved",
      cash_flow_id: originalTxn.cash_flow_id || MAIN_CASH_FLOW_ID,
      source_type: originalTxn.source_type || null,
      file_source: originalTxn.file_source || null,
      bank_scraper_source_id: originalTxn.bank_scraper_source_id || null,
      normalized_amount: originalTxn.excluded_from_flow ? 0 : Math.abs(s.amount),
      original_amount: originalTxn.original_amount ?? originalTxn.amount,
      original_currency: originalTxn.original_currency || originalTxn.currency || "ILS",
      transaction_type: originalTxn.transaction_type || "normal",
      notes: noteParts.join(" | "),
    };
  });

  const { error: insertError } = await db.from("transactions").insert(newTxns);
  if (insertError) throw insertError;

  const { error: deleteError } = await db.from("transactions").delete().eq("id", originalTxn.id);
  if (deleteError) throw deleteError;
}

// Cancel a split: restore the original transaction and delete all split sibling parts
export async function unsplitTransaction(txn: Txn, allTxns: Txn[]): Promise<void> {
  const db = supabase as any;
  if (!isSplitTxn(txn)) {
    throw new Error("רשומה זו אינה חלק מפיצול עסקה");
  }

  let groupId: string | null = null;
  let origAmount = 0;
  let origCategory = txn.source_category || txn.category_name || "הוצאות משתנות";
  let origNotes = "";

  const match = txn.notes?.match(/\[SPLIT:([^:]+):([^:]+):([^:]*):([^\]]*)\]/);
  if (match) {
    groupId = match[1];
    origAmount = Number(match[2]);
    if (match[3]) origCategory = match[3];
    try { origNotes = decodeURIComponent(match[4]); } catch { origNotes = ""; }
  }

  let siblingTxns: Txn[] = [];
  if (groupId) {
    siblingTxns = allTxns.filter((t) => t.notes?.includes(`[SPLIT:${groupId}:`));
  }

  if (!siblingTxns.length) {
    siblingTxns = allTxns.filter(
      (t) =>
        t.business_name === txn.business_name &&
        t.payment_date === txn.payment_date &&
        (t.cash_flow_id === txn.cash_flow_id || !t.cash_flow_id) &&
        isSplitTxn(t)
    );
  }

  if (!siblingTxns.length) {
    siblingTxns = [txn];
  }

  const sign = txn.amount < 0 ? -1 : 1;
  const totalAmount = origAmount > 0 
    ? origAmount * sign 
    : siblingTxns.reduce((sum, t) => sum + t.amount, 0);

  if (!origNotes) {
    const rawNote = txn.notes || "";
    if (rawNote.includes("הערת מקור:")) {
      origNotes = rawNote.split("הערת מקור:")[1]?.split("|")[0]?.trim() || "";
    }
  }

  const restoredTxn = {
    user_id: txn.user_id || MAIN_USER_ID,
    config_id: txn.config_id || null,
    business_name: txn.business_name,
    payment_date: txn.payment_date,
    charge_date: txn.charge_date,
    amount: Number(totalAmount.toFixed(2)),
    currency: txn.currency || "ILS",
    payment_method: txn.payment_method,
    flow_month: txn.flow_month,
    excluded_from_flow: txn.excluded_from_flow,
    category_name: origCategory,
    source_category: txn.source_category,
    status: txn.status || "approved",
    cash_flow_id: txn.cash_flow_id || MAIN_CASH_FLOW_ID,
    source_type: txn.source_type || null,
    file_source: txn.file_source || null,
    bank_scraper_source_id: txn.bank_scraper_source_id || null,
    normalized_amount: txn.excluded_from_flow ? 0 : Math.abs(Number(totalAmount.toFixed(2))),
    original_amount: txn.original_amount ?? Number(totalAmount.toFixed(2)),
    original_currency: txn.original_currency || txn.currency || "ILS",
    transaction_type: txn.transaction_type || "normal",
    notes: origNotes || null,
  };

  const { error: insertError } = await db.from("transactions").insert(restoredTxn);
  if (insertError) throw insertError;

  const siblingIds = siblingTxns.map((t) => t.id);
  const { error: deleteError } = await db.from("transactions").delete().in("id", siblingIds);
  if (deleteError) throw deleteError;

  return restoredTxn;
}

export function buildMonth(
  month: string,
  txns: Txn[],
  cats: Category[],
  cashFlows: CashFlow[] = [],
  categoryOrder: CategoryOrder[] = [],
  sharedTargets: SharedCategoryTarget[] = [],
  monthlyTargets: MonthlyTarget[] = [],
  monthlyGoals: MonthlyGoal[] = []
): MonthModel {
  // name -> type / color maps from categories table (last wins)
  const typeMap = new Map<string, string>();
  const colorMap = new Map<string, string>();
  for (const c of cats) {
    if (c.category_type) typeMap.set(c.name, c.category_type);
    if (c.color) colorMap.set(c.name, c.color);
  }
  const cf = primaryCashFlow(txns, cashFlows);
  const flowTxns = cf ? txns.filter((t) => t.cash_flow_id === cf) : txns;
  const mainFlow = cf ? cashFlows.find((flow) => flow.id === cf) : null;
  const mainUserId = mainFlow?.user_id || flowTxns.find((t) => t.user_id)?.user_id || null;
  // Normalised config per category, preferring live (RLS-permitting) data and
  // falling back to the embedded snapshot when the anon key can't read the tables.
  type Cfg = { monthlyTarget: number | null; sharedCategory: string | null; weeklyDisplay: boolean; displayOrder: number; useSharedTarget: boolean };
  const cfgMap = new Map<string, Cfg>();
  for (const [name, c] of Object.entries(CATEGORY_ORDER)) {
    cfgMap.set(name, { monthlyTarget: c.monthlyTarget, sharedCategory: c.sharedCategory, weeklyDisplay: c.weeklyDisplay, displayOrder: c.displayOrder, useSharedTarget: c.useSharedTarget });
  }
  for (const c of categoryOrder.filter((category) => !mainUserId || category.user_id === mainUserId)) {
    cfgMap.set(c.category_name, {
      monthlyTarget: c.monthly_target,
      sharedCategory: c.shared_category,
      weeklyDisplay: !!c.weekly_display,
      displayOrder: CATEGORY_ORDER[c.category_name]?.displayOrder ?? (c.display_order ?? 9999),
      useSharedTarget: !!c.use_shared_target,
    });
  }
  const sharedTargetMap = new Map<string, { monthlyTarget: number | null; weeklyDisplay: boolean }>(
    Object.entries(SHARED_TARGETS).map(([k, v]) => [k, { monthlyTarget: v.monthlyTarget, weeklyDisplay: v.weeklyDisplay }])
  );
  for (const t of sharedTargets.filter((target) => !mainUserId || target.user_id === mainUserId)) {
    sharedTargetMap.set(t.shared_category_name, { monthlyTarget: t.monthly_target, weeklyDisplay: !!t.weekly_display });
  }

  // This month's plan wins over the global per-category figure. A category with a row
  // here is planned for THIS month only, which is what stops last month's one-offs from
  // being budgeted again.
  const planned = new Map<string, number>();
  for (const t of monthlyTargets) {
    if (t.flow_month !== month) continue;
    if (cf && t.cash_flow_id && t.cash_flow_id !== cf) continue;
    if (mainUserId && t.user_id && t.user_id !== mainUserId) continue;
    planned.set(t.category_name, Number(t.amount) || 0);
  }

  // Weekly budgeting is the active experience. Keep legacy monthly-goal data
  // readable for backwards compatibility, but do not deduct it from the
  // variable-expense allowance or surface it in the UI.
  const monthlyGoal = 0;

  // null means "no forecast at all" — distinct from a deliberate 0, which is what a
  // category you are not planning to spend on this month looks like.
  const targetOf = (name: string | null): number | null => {
    if (!name) return null;
    if (planned.has(name)) return planned.get(name)!;
    const row = cfgMap.get(name);
    if (!row) return null;
    if (row.useSharedTarget && row.sharedCategory) {
      const shared = sharedTargetMap.get(row.sharedCategory)?.monthlyTarget ?? row.monthlyTarget;
      return shared == null ? null : Number(shared);
    }
    return row.monthlyTarget == null ? null : Number(row.monthlyTarget);
  };
  const weeklyOf = (name: string | null): boolean => {
    if (!name) return false;
    const row = cfgMap.get(name);
    if (!row) return false;
    if (row.useSharedTarget && row.sharedCategory) {
      return Boolean(sharedTargetMap.get(row.sharedCategory)?.weeklyDisplay ?? row.weeklyDisplay);
    }
    return Boolean(row.weeklyDisplay);
  };
  const fixedCategoryOverrides = new Set(["RiseUp"]);
  const variableCategoryOverrides = new Set(["חסכון קרן כספית"]);
  const displayOrderOf = (name: string | null): number => cfgMap.get(name || "")?.displayOrder ?? 9999;
  const sharedOf = (name: string | null): string | null => {
    if (fixedCategoryOverrides.has(name || "")) return "הוצאות קבועות";
    return cfgMap.get(name || "")?.sharedCategory ?? null;
  };

  // Mirrors legacy AdditionalMethods.inferCategoryType exactly enough for the
  // production categories. Shared-category grouping is handled after totals.
  const typeOf = (n: string | null): string => {
    if (variableCategoryOverrides.has(n || "")) return "variable_expense";
    const sharedCategory = sharedOf(n);
    if (sharedCategory === "הכנסות") return "income";
    if (sharedCategory === "הוצאות קבועות") return "fixed_expense";
    if (sharedCategory === "הפקדות לחיסכון") return "savings";
    const name = (n || "").toLowerCase();
    if (name.includes("הכנסות") || name.includes("משכורת") || name.includes("פרילנס")) return "income";
    if (name.includes("קבועות") || name.includes("ביטוח") || name.includes("ארנונה")) return "fixed_expense";
    if (name.includes("חיסכון") || name.includes("חסכון") || name.includes("השקעות")) return "savings";
    return "variable_expense";
  };
  const colorOf = (n: string | null) => (n && colorMap.get(n)) || RISE.blue;

  const months = Array.from(new Set(flowTxns.map((t) => t.flow_month).filter(Boolean) as string[])).sort();

  const monthTxns = flowTxns.filter((t) => t.flow_month === month);

  // "לא בתזרים" is decided per transaction, by the flag OR the category — a transaction
  // the user pushed out of the flow has to leave its category card too, not just the
  // totals, otherwise the category shows money that the flow says was never spent.
  const outOfFlowOf = (t: Txn) =>
    Boolean(t.excluded_from_flow) ||
    sharedOf(t.category_name) === "לא בתזרים" ||
    (t.category_name || "").includes("לא תזרימי");
  const inFlowTxns = monthTxns.filter((t) => !outOfFlowOf(t));
  const outOfFlowTxns = monthTxns.filter(outOfFlowOf);

  const rawGroups = groupByCategory(inFlowTxns, colorOf, typeOf, targetOf, displayOrderOf, weeklyOf, sharedOf);

  // A category can be planned for this month without having been spent on yet. It still
  // has to appear, and its plan still ties up money, so give it an empty group.
  const SHARED_BUCKET_NAMES = new Set(["הכנסות", "הוצאות קבועות", "הפקדות לחיסכון", "לא בתזרים"]);
  const grouped = new Set(rawGroups.map((g) => g.name));
  for (const [name, amount] of planned) {
    if (grouped.has(name) || SHARED_BUCKET_NAMES.has(name) || name === "הוצאות משתנות") continue;
    rawGroups.push({
      name,
      color: colorOf(name),
      type: typeOf(name),
      spent: 0,
      expected: amount,
      displayOrder: displayOrderOf(name),
      weeklyDisplay: weeklyOf(name),
      sharedCategory: sharedOf(name),
      txns: [],
    });
  }
  const regular = rawGroups.filter((g) => !g.sharedCategory).sort((a, b) => a.displayOrder - b.displayOrder || b.spent - a.spent);
  const shared = processSharedGroups(rawGroups);

  let incomeGot = 0;
  let fixedTotal = 0;
  let variableTotal = 0;
  let savingsTotal = 0;
  for (const t of inFlowTxns) {
    const amount = signed(t.amount);
    const name = t.category_name || "Uncategorized";
    const type = typeOf(name);
    const isSavingsCategory = name.includes("חיסכון") || name.includes("חסכון");
    if (type === "income") {
      incomeGot += amount;
    } else {
      const bucket = type === "fixed_expense" ? "fixed" : "variable";
      // Expense-ness is category-driven, not sign-driven. Positive amounts can be
      // refunds/reversals in an expense category and must not reduce total spending.
      const contribution = abs(amount);
      if (bucket === "fixed") fixedTotal += contribution;
      else variableTotal += contribution;
      if (isSavingsCategory) savingsTotal += contribution;
    }
  }

  const fixedSubGroups = rawGroups
    .filter((g) => sharedOf(g.name) === "הוצאות קבועות" || g.sharedCategory === "הוצאות קבועות" || typeOf(g.name) === "fixed_expense")
    .sort((a, b) => {
      if (a.name === "RiseUp") return -1;
      if (b.name === "RiseUp") return 1;
      return a.name.localeCompare(b.name, "he");
    });
  const savingsSubGroups = rawGroups
    .filter((g) => sharedOf(g.name) === "הפקדות לחיסכון" || g.sharedCategory === "הפקדות לחיסכון" || typeOf(g.name) === "savings")
    .sort((a, b) => a.displayOrder - b.displayOrder || b.spent - a.spent);

  const groupBudget = (key: string, fallback: number) =>
    planned.has(key) ? planned.get(key)! : Number(sharedTargetMap.get(key)?.monthlyTarget ?? fallback);
  const byName = (name: string) => regular.find((g) => g.name === name);
  const sharedByName = (name: string) => shared.find((g) => g.name === name);

  const trackedVariable = [...regular]
    .filter((g) => g.type !== "income" && g.name !== "הוצאות משתנות" && sharedOf(g.name) !== "הוצאות קבועות" && sharedOf(g.name) !== "הפקדות לחיסכון")
    .sort((a, b) => a.displayOrder - b.displayOrder || b.spent - a.spent);

  const fixedGroup = sharedByName("הוצאות קבועות");
  const savingsGroup = sharedByName("הפקדות לחיסכון");
  const incomeGroup = sharedByName("הכנסות");
  const fixedGroups = fixedSubGroups.length > 0 ? fixedSubGroups : fixedGroup ? [fixedGroup] : [];
  const savings = savingsSubGroups.length > 0 ? savingsSubGroups : savingsGroup ? [savingsGroup] : [];
  const incGroups = incomeGroup ? [incomeGroup] : regular.filter((g) => g.type === "income");
  const incFixed = incGroups.filter((g) => g.name.includes("קבוע") || g.txns.some((t) => (t.category_name || "").includes("קבוע")));
  const incVar = incGroups.filter((g) => !incFixed.includes(g));
  // Fixed expenses are forecast from LAST month's actual bill and get replaced by this
  // month's as the charges land ("כמה כסף נשאר להוציא בכל קטגוריה"). A stored plan for
  // the month still wins; the global shared target is only the last resort.
  const prevMonth = months.filter((m) => m < month).pop();
  const prevFixedActual = prevMonth
    ? flowTxns
        .filter((t) => t.flow_month === prevMonth && !outOfFlowOf(t) && (typeOf(t.category_name) === "fixed_expense" || sharedOf(t.category_name) === "הוצאות קבועות"))
        .reduce((s, t) => s + abs(t.amount), 0)
    : 0;
  const fixedActual = fixedGroup?.spent ?? fixedTotal;
  const fixedExpected = planned.has("הוצאות קבועות")
    ? planned.get("הוצאות קבועות")!
    : prevFixedActual > 0
      ? Math.max(prevFixedActual, fixedActual)
      : groupBudget("הוצאות קבועות", fixedActual);
  const savingsExpected = groupBudget("הפקדות לחיסכון", savingsGroup?.spent ?? savingsTotal);

  // Income below the forecast is NOT used — mid-month the salary simply hasn't arrived
  // yet, and planning against it would zero the budget out every month until payday.
  const incomeForecast = groupBudget("הכנסות", abs(incomeGot));
  const incomeExpected = Math.max(incomeForecast, incomeGot);

  // A committed bucket ties up whichever is larger: what it still plans to spend, or
  // what it has already spent. Overruns therefore reduce what is left for the general
  // variable bucket, exactly like a bigger plan would have.
  const committed = (spent: number, expected: number) => Math.max(spent, expected);
  const trackedCommitted = trackedVariable.reduce((s, g) => s + committed(g.spent, g.expected), 0);

  // The general "הוצאות משתנות" bucket is not a stored budget — it is the remainder of
  // the plan, and it absorbs every deviation from it:
  //   income - monthly goal - fixed - savings - the tracked categories' own budgets
  // Verified against the live app, July 2026: 25,450.3 - 10 - 10,427.2 - 2,501.2
  // - 5,885.3 = 6,626.6 against its displayed 6,626.5.
  //
  // Sub-categories that belong to "הוצאות משתנות" (like super, restaurants, etc.) are
  // tracked separately, so their targets tie up space inside the flexible budget.
  const untrackedVariableTxns = inFlowTxns.filter((t) => typeOf(t.category_name) === "variable_expense" && (t.category_name === "הוצאות משתנות" || !trackedVariable.some((g) => g.name === t.category_name)));
  const genericVariableSpent = untrackedVariableTxns.reduce((s, t) => s + abs(t.amount), 0);

  const variableBucket = {
    name: "הוצאות משתנות",
    color: RISE.yellow,
    type: "variable_expense",
    spent: genericVariableSpent,
    expected: Math.max(0, incomeExpected - monthlyGoal - fixedExpected - savingsExpected - trackedCommitted),
    displayOrder: 0,
    weeklyDisplay: true,
    sharedCategory: null,
    txns: untrackedVariableTxns,
  };

  const netPlan = incomeExpected - monthlyGoal - fixedExpected - savingsExpected;

  const totalSpent = fixedTotal + variableTotal;
  // What will have left the account if nothing more comes out of the flexible bucket —
  // committed buckets at their plan, the general bucket at what has actually gone out.
  // A bucket that already exceeded its target is still money that will have
  // left the account. Keep the headline internally consistent: expected can
  // never be lower than actual spending for fixed expenses, savings, or the
  // tracked variable categories.
  const totalExpected = fixedExpected + Math.max(savingsExpected, savingsTotal) + trackedCommitted + variableBucket.spent;

  // Built from the transactions themselves, not from a category grouping, so anything
  // the user pushed out of the flow by hand shows up here.
  const nifIncome = outOfFlowTxns.filter((t) => typeOf(t.category_name) === "income");
  const nifExpense = outOfFlowTxns.filter((t) => typeOf(t.category_name) !== "income");

  return {
    month,
    months,
    userId: mainUserId,
    cashFlowId: cf,
    income: { got: incomeGot, expected: incomeExpected, fixed: incFixed, variable: incVar },
    variableBucket,
    trackedVariable,
    fixed: { total: fixedGroup?.spent ?? fixedTotal, expected: fixedExpected, groups: fixedGroups },
    savings: { total: savingsGroup?.spent ?? savingsTotal, expected: savingsExpected, groups: savings },
    totalSpent,
    totalExpected,
    monthlyGoal,
    // < 0 means the month is planned to end short. Each variable expense deepens it,
    // which is why the spend is subtracted here too.
    netPlan,
    deficit: netPlan < 0 ? netPlan - variableBucket.spent : 0,
    notInFlow: {
      incomeTotal: nifIncome.reduce((s, t) => s + abs(t.amount), 0),
      expenseTotal: nifExpense.reduce((s, t) => s + abs(t.amount), 0),
      incomeTxns: nifIncome,
      expenseTxns: nifExpense,
    },
  };
}

function groupByCategory(
  list: Txn[],
  colorOf: (n: string | null) => string,
  typeOf: (n: string | null) => string,
  targetOf: (n: string | null) => number | null,
  displayOrderOf: (n: string | null) => number,
  weeklyOf: (n: string | null) => boolean,
  sharedOf: (n: string | null) => string | null
): CategoryGroup[] {
  const map = new Map<string, Txn[]>();
  for (const t of list) {
    const key = t.category_name || "אחר";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  const out: CategoryGroup[] = [];
  for (const [name, txns] of map) {
    const spent = txns.reduce((s, t) => s + abs(t.amount), 0);
    // A planned 0 must survive: it is what turns the whole spend into an overrun,
    // exactly as the real app shows it ("צפוי היה לצאת 0.0 · חריגה של 234").
    const target = targetOf(name);
    const expected = target == null ? spent : target;
    out.push({
      name,
      color: colorOf(name),
      type: typeOf(name),
      spent,
      // Kept unrounded — plans carry agorot (1,039.6) and rounding them invents overruns.
      expected,
      displayOrder: displayOrderOf(name),
      weeklyDisplay: weeklyOf(name),
      sharedCategory: sharedOf(name),
      txns,
    });
  }
  return out;
}

function processSharedGroups(groups: CategoryGroup[]): CategoryGroup[] {
  const sharedMap = new Map<string, CategoryGroup>();
  for (const group of groups) {
    if (!group.sharedCategory || group.txns.length === 0) continue;
    const existing = sharedMap.get(group.sharedCategory);
    if (!existing) {
      sharedMap.set(group.sharedCategory, {
        name: group.sharedCategory,
        color: group.type === "income" ? RISE.green : group.sharedCategory === "הפקדות לחיסכון" ? RISE.orange : RISE.pink,
        type: group.type,
        spent: group.spent,
        expected: group.expected,
        displayOrder: group.displayOrder,
        weeklyDisplay: false,
        sharedCategory: null,
        txns: [...group.txns],
      });
    } else {
      existing.spent += group.spent;
      existing.expected += group.expected;
      existing.displayOrder = Math.min(existing.displayOrder, group.displayOrder);
      existing.txns.push(...group.txns);
    }
  }
  return Array.from(sharedMap.values()).sort((a, b) => a.displayOrder - b.displayOrder || b.spent - a.spent);
}

// ---- Hebrew calendar weeks (Sunday–Saturday), matching the reference backend ----
// Week 1 runs from day 1 to the first Saturday; subsequent weeks are Sun–Sat.
export type MonthWeek = { week: number; startDay: number; endDay: number; label: string; range: string };

export function getMonthWeeks(year: number, month: number): MonthWeek[] {
  const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const weeks: MonthWeek[] = [];
  let w = 1;
  let start = 1;
  while (start <= daysInMonth) {
    let end: number;
    if (w === 1) {
      const daysUntilSat = (6 - firstDow + 7) % 7;
      end = Math.min(start + daysUntilSat, daysInMonth);
    } else {
      end = Math.min(start + 6, daysInMonth);
    }
    weeks.push({ week: w, startDay: start, endDay: end, label: `שבוע ${w}`, range: `${start}-${end}` });
    start = end + 1;
    w++;
  }
  return weeks;
}

// Calendar week index for a date string ("YYYY-MM-DD") within the given month.
export function weekIndexOf(dateStr: string | null, year: number, month: number): number {
  if (!dateStr) return 1;
  const firstDow = new Date(year, month - 1, 1).getDay();
  const day = Number(dateStr.slice(8, 10));
  return Math.ceil((day + firstDow) / 7);
}

export function ymOf(monthStr: string): { year: number; month: number } {
  const [y, m] = monthStr.split("-");
  return { year: Number(y), month: Number(m) };
}

// A transaction is placed in the week of its flow month, clamped into that month.
export function flowDate(t: Txn): string {
  if (!t.flow_month) return t.payment_date || t.charge_date || "";
  const source = t.payment_date || t.charge_date || "";
  const rawDay = source ? Number(source.slice(8, 10)) : 1;
  const [year, month] = t.flow_month.split("-").map(Number);
  const daysInFlowMonth = new Date(year, month, 0).getDate();
  const day = Math.min(Math.max(rawDay || 1, 1), daysInFlowMonth);
  return `${t.flow_month}-${String(day).padStart(2, "0")}`;
}

// 1-based week number containing today, or 0 when today is outside the given month.
export function currentWeekIndex(monthStr: string, today: Date = new Date()): number {
  const { year, month } = ymOf(monthStr);
  if (today.getFullYear() !== year || today.getMonth() + 1 !== month) return 0;
  return weekIndexOf(`${monthStr}-${String(today.getDate()).padStart(2, "0")}`, year, month);
}

export type WeekBudget = MonthWeek & {
  days: number;
  budget: number;
  spent: number;
  remaining: number;
  isCurrent: boolean;
  isPast: boolean;
  isFuture: boolean;
  txns: Txn[];
};

// Riseup's weekly split. Weeks run Sunday–Saturday and are shortened at both month
// boundaries (see the help-centre article "מה זה שבוע בתזרים?"), and the budget is
// spread over them BY DAYS, not evenly per week.
//
// The plan is redrawn at the start of the current week: whatever the monthly variable
// budget still had left when the week opened is divided by the number of days from the
// current week to the end of the month, and each remaining week gets that daily rate
// times its own day count. Weeks that already ended show 0 — their money has either
// been spent or already rolled into the current week's rate.
//
// Verified against the live app, July 2026 (budget 6,626.5; weeks 4/7/7/7/6 days;
// spent 699.8 / 370.6 / 165.0 / 80.3 / 0 with today inside week 4):
//   left when week 4 opened = 6,626.5 - 1,235.4 = 5,391.1 over 13 days = 414.70/day
//   week 4 -> 414.70*7 - 80.3 = 2,822.6   week 5 -> 414.70*6 = 2,488.2   weeks 1-3 -> 0
export function weeklyBreakdown(
  txns: Txn[],
  monthStr: string,
  monthlyBudget: number,
  today: Date = new Date()
): WeekBudget[] {
  const { year, month } = ymOf(monthStr);
  const current = currentWeekIndex(monthStr, today);
  // Outside the live month there is no "current week", so the whole month is still ahead.
  const refWeek = current > 0 ? current : 1;

  const rows = getMonthWeeks(year, month).map((mw) => {
    const wkTxns = txns.filter((t) => weekIndexOf(flowDate(t), year, month) === mw.week);
    return {
      mw,
      txns: wkTxns,
      days: mw.endDay - mw.startDay + 1,
      spent: wkTxns.reduce((s, t) => s + abs(t.amount), 0),
    };
  });

  const spentBefore = rows.filter((r) => r.mw.week < refWeek).reduce((s, r) => s + r.spent, 0);
  const daysAhead = rows.filter((r) => r.mw.week >= refWeek).reduce((s, r) => s + r.days, 0) || 1;
  const daily = Math.max(0, monthlyBudget - spentBefore) / daysAhead;

  return rows.map(({ mw, txns: wkTxns, days, spent }) => {
    const isPast = mw.week < refWeek;
    const budget = isPast ? 0 : daily * days;
    return {
      ...mw,
      days,
      budget,
      spent,
      remaining: Math.max(0, budget - spent),
      isCurrent: mw.week === current,
      isPast,
      isFuture: mw.week > refWeek,
      txns: wkTxns,
    };
  });
}

// The headline "how much is left to spend on variable expenses this week" figure —
// the current week's own slice minus what already went out during it.
export function weekRemaining(
  txns: Txn[],
  monthStr: string,
  monthlyBudget: number,
  today: Date = new Date()
): number {
  const weeks = weeklyBreakdown(txns, monthStr, monthlyBudget, today);
  const week = weeks.find((w) => w.isCurrent) ?? weeks[0];
  return week ? week.remaining : 0;
}
