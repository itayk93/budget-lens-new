import { supabase } from "@/integrations/supabase/client";
import { Txn, CategoryOrder, SharedCategoryTarget, MonthlyTarget } from "./compute";

// Riseup's start-of-month behaviour, from its help centre:
//  - "תחילת חודש ותזרים חדש": income and fixed expenses roll over automatically.
//  - tracked variable expenses do not roll over automatically.
//
// The app stores zero for tracked categories in a fresh month, then offers the
// three-month average as a one-click suggestion in the edit sheet. That prevents
// one-off expenses from silently becoming next month's plan.

const SHARED_BUCKETS = ["הכנסות", "הוצאות קבועות", "הפקדות לחיסכון"];

/** Mean monthly spend over the last `months` months that have data, excluding `upTo`. */
export function suggestFromHistory(
  txns: Txn[],
  cashFlowId: string | null,
  categoryName: string,
  upTo: string,
  months = 3
): number {
  const byMonth = new Map<string, number>();
  for (const t of txns) {
    if (cashFlowId && t.cash_flow_id !== cashFlowId) continue;
    if (t.category_name !== categoryName || !t.flow_month) continue;
    if (t.flow_month >= upTo) continue;
    byMonth.set(t.flow_month, (byMonth.get(t.flow_month) || 0) + Math.abs(Number(t.amount) || 0));
  }
  const recent = [...byMonth.keys()].sort().slice(-months);
  if (!recent.length) return 0;
  return recent.reduce((s, m) => s + (byMonth.get(m) || 0), 0) / recent.length;
}

export type CategoryHistoryPoint = { label: string; amount: number };

/** The five most recent completed months used by the forecast card's chart. */
export function categoryHistory(
  txns: Txn[],
  cashFlowId: string | null,
  categoryName: string,
  upTo: string,
  months = 5,
): CategoryHistoryPoint[] {
  const byMonth = new Map<string, number>();
  for (const t of txns) {
    if (cashFlowId && t.cash_flow_id !== cashFlowId) continue;
    if (t.category_name !== categoryName || !t.flow_month || t.flow_month >= upTo) continue;
    byMonth.set(t.flow_month, (byMonth.get(t.flow_month) || 0) + Math.abs(Number(t.amount) || 0));
  }
  return [...byMonth.keys()]
    .sort()
    .slice(-months)
    .reverse()
    .map((flowMonth) => {
      const [, month] = flowMonth.split("-");
      const label = ["ינואר", "פברואר", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"][Number(month) - 1];
      return { label, amount: byMonth.get(flowMonth) || 0 };
    });
}

/**
 * Seed the plan for `month` if it has none yet. Shared buckets carry their previous
 * figure forward; tracked variable categories are seeded at zero, matching Riseup.
 * Returns the rows that were written (empty when the month was already planned).
 */
export async function ensureMonthPlan(opts: {
  userId: string;
  cashFlowId: string;
  month: string;
  txns: Txn[];
  categoryOrder: CategoryOrder[];
  sharedTargets: SharedCategoryTarget[];
  monthlyTargets: MonthlyTarget[];
}): Promise<MonthlyTarget[]> {
  const { userId, cashFlowId, month, txns, categoryOrder, sharedTargets, monthlyTargets } = opts;
  const mine = monthlyTargets.filter((t) => t.user_id === userId && t.cash_flow_id === cashFlowId);
  if (mine.some((t) => t.flow_month === month)) return [];

  const previous = [...new Set(mine.map((t) => t.flow_month))].filter((m) => m < month).sort().pop();
  const carried = new Map(mine.filter((t) => t.flow_month === previous).map((t) => [t.category_name, Number(t.amount) || 0]));
  const sharedFallback = new Map(sharedTargets.map((t) => [t.shared_category_name, Number(t.monthly_target) || 0]));

  const rows = [
    ...SHARED_BUCKETS.map((name) => ({
      user_id: userId,
      cash_flow_id: cashFlowId,
      flow_month: month,
      category_name: name,
      amount: carried.get(name) ?? sharedFallback.get(name) ?? 0,
      is_suggestion: true,
    })),
    // Tracked categories start unplanned every month. The historical average is only
    // a suggestion in the edit sheet, not an automatic budget.
    ...categoryOrder
      .filter((c) => c.user_id === userId && !c.shared_category && c.category_name !== "הוצאות משתנות")
      .map((c) => ({
        user_id: userId,
        cash_flow_id: cashFlowId,
        flow_month: month,
        category_name: c.category_name,
        amount: 0,
        is_suggestion: true,
      })),
  ];
  if (!rows.length) return [];

  const db = supabase as any;
  const { data, error } = await db
    .from("monthly_category_targets")
    .upsert(rows, { onConflict: "user_id,cash_flow_id,category_name,flow_month", ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return (data || []) as MonthlyTarget[];
}
