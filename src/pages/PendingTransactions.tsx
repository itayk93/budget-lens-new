import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/riseup/components";
import { supabase } from "@/integrations/supabase/client";
import { MAIN_CASH_FLOW_ID } from "@/riseup/configSnapshot";
import { useAuth } from "@/hooks/useAuth";
import { RISE } from "@/riseup/compute";

type PendingTransaction = {
  id: number;
  user_id: string;
  business_name: string | null;
  payment_date: string | null;
  charge_date: string | null;
  amount: number;
  currency: string | null;
  payment_method: string | null;
  category_name: string | null;
  source_category: string | null;
  status: string | null;
  flow_month: string | null;
  notes: string | null;
  excluded_from_flow: boolean | null;
  config_id: number;
  payment_identifier: string | null;
  original_amount: number | null;
  original_currency: string | null;
  transaction_type: string | null;
  bank_scraper_source_id: number | null;
  created_at: string;
};

type SyncRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  total_new_pending: number;
  total_classified_from_memory: number;
  total_classified_from_ai: number;
  total_failed_providers: number;
  error_summary: string | null;
};

function isMissingRelationError(error: any) {
  return error?.code === "42P01";
}

function amountLabel(amount: number) {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${Math.abs(Math.round(amount)).toLocaleString("en-US")} ₪`;
}

function dateLabel(value: string | null) {
  if (!value) return "ללא תאריך";
  return new Date(value).toLocaleDateString("he-IL");
}

export default function PendingTransactions() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<PendingTransaction[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [syncRun, setSyncRun] = useState<SyncRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!user) {
      setRows([]);
      setCategories([]);
      setSyncRun(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const db = supabase as any;
      const [pendingRes, categoriesRes, runRes] = await Promise.all([
        db
          .from("bank_scraper_pending_transactions")
          .select("*")
          .eq("status", "pending")
          .eq("suppress_from_automation", false)
          .order("payment_date", { ascending: false })
          .limit(500),
        db
          .from("category_order")
          .select("category_name")
          .order("display_order", { ascending: true })
          .limit(500),
        db
          .from("bank_scraper_sync_runs")
          .select("id,started_at,finished_at,status,total_new_pending,total_classified_from_memory,total_classified_from_ai,total_failed_providers,error_summary")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (pendingRes.error) throw pendingRes.error;
      if (categoriesRes.error) throw categoriesRes.error;
      if (runRes.error && !isMissingRelationError(runRes.error)) throw runRes.error;

      setRows((pendingRes.data || []) as PendingTransaction[]);
      setCategories(Array.from(new Set((categoriesRes.data || []).map((row: { category_name: string }) => row.category_name).filter(Boolean))));
      setSyncRun(runRes.error ? null : ((runRes.data || null) as SyncRun | null));
    } catch (loadError: any) {
      setError(loadError.message || "טעינת הרשומות נכשלה");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    loadData();
  }, [authLoading, user]);

  const pendingCount = rows.length;

  const groupedByMonth = useMemo(() => {
    const groups = new Map<string, PendingTransaction[]>();
    for (const row of rows) {
      const key = row.flow_month || "ללא חודש";
      const bucket = groups.get(key) || [];
      bucket.push(row);
      groups.set(key, bucket);
    }
    return [...groups.entries()];
  }, [rows]);

  const updateCategory = async (rowId: number, categoryName: string) => {
    setSavingId(rowId);
    setError(null);
    setMessage(null);
    try {
      const db = supabase as any;
      const { error: updateError } = await db
        .from("bank_scraper_pending_transactions")
        .update({ category_name: categoryName })
        .eq("id", rowId);
      if (updateError) throw updateError;

      setRows((prev) => prev.map((row) => row.id === rowId ? { ...row, category_name: categoryName } : row));
      setMessage("הקטגוריה עודכנה.");
    } catch (updateError: any) {
      setError(updateError.message || "עדכון הקטגוריה נכשל");
    } finally {
      setSavingId(null);
    }
  };

  const approveRow = async (row: PendingTransaction) => {
    setSavingId(row.id);
    setError(null);
    setMessage(null);
    try {
      const db = supabase as any;
      const nowIso = new Date().toISOString();
      const categoryName = row.category_name || "אחר";
      const normalizedAmount = row.excluded_from_flow ? 0 : Math.abs(row.amount);

      const { error: insertError } = await db.from("transactions").insert({
        user_id: row.user_id,
        config_id: row.config_id,
        business_name: row.business_name,
        payment_date: row.payment_date,
        charge_date: row.charge_date,
        amount: row.amount,
        currency: row.currency || "ILS",
        payment_method: row.payment_method,
        flow_month: row.flow_month,
        excluded_from_flow: !!row.excluded_from_flow,
        category_name: categoryName,
        effective_category_name: categoryName,
        source_category: row.source_category,
        status: "approved",
        cash_flow_id: MAIN_CASH_FLOW_ID,
        normalized_amount: normalizedAmount,
        original_amount: row.original_amount,
        original_currency: row.original_currency,
        transaction_type: row.transaction_type,
        bank_scraper_source_id: row.bank_scraper_source_id,
        updated_at: nowIso,
      });
      if (insertError) throw insertError;

      const { error: pendingError } = await db
        .from("bank_scraper_pending_transactions")
        .update({ status: "approved", reviewed_at: nowIso })
        .eq("id", row.id);
      if (pendingError) throw pendingError;

      setRows((prev) => prev.filter((candidate) => candidate.id !== row.id));
      setMessage("הרשומה הועברה לעסקאות ואושרה.");
    } catch (approveError: any) {
      setError(approveError.message || "אישור הרשומה נכשל");
    } finally {
      setSavingId(null);
    }
  };

  const dismissRow = async (rowId: number) => {
    setSavingId(rowId);
    setError(null);
    setMessage(null);
    try {
      const db = supabase as any;
      const { error: dismissError } = await db
        .from("bank_scraper_pending_transactions")
        .update({
          status: "dismissed",
          suppress_from_automation: true,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", rowId);
      if (dismissError) throw dismissError;

      setRows((prev) => prev.filter((row) => row.id !== rowId));
      setMessage("הרשומה הוסתרה מהאוטומציה.");
    } catch (dismissError: any) {
      setError(dismissError.message || "דחיית הרשומה נכשלה");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: RISE.cream, fontFamily: "Heebo, sans-serif", textAlign: "right" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", background: "#fff", minHeight: "100vh", padding: 16, boxShadow: "0 0 30px rgba(0,0,0,0.06)", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#202125" }}>רשומות ממתינות מהבנק</h1>
            <p style={{ margin: "6px 0 0", color: "#6B7280" }}>
              מעבר על עסקאות חדשות לפני שהן נכנסות לדאטה הראשי.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="outline" className="flex-row-reverse gap-2" onClick={loadData}>
              <RefreshCw className="h-4 w-4" />
              רענון
            </Button>
            <Button variant="ghost" className="flex-row-reverse gap-2" onClick={() => navigate("/")}>
              <ArrowRight className="h-4 w-4" />
              חזרה
            </Button>
          </div>
        </div>

        {!authLoading && !user && (
          <Card>
            <div style={{ padding: 20, display: "grid", gap: 12 }}>
              <strong style={{ fontSize: 18, color: "#202125" }}>אין session מחובר</strong>
              <div style={{ color: "#6B7280" }}>
                הדאטה קיים ב־Supabase, אבל הדפדפן ניגש כרגע כאנונימי ולכן השאילתה מחזירה 0 רשומות.
              </div>
              <div>
                <Link to="/login">
                  <Button className="flex-row-reverse gap-2">להתחברות</Button>
                </Link>
              </div>
            </div>
          </Card>
        )}

        {syncRun && (
          <Card>
            <div style={{ padding: 16, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <strong>ריצת הסנכרון האחרונה</strong>
                <span style={{ color: syncRun.status === "success" ? "#166534" : syncRun.status === "partial" ? "#B45309" : "#991B1B" }}>
                  {syncRun.status}
                </span>
              </div>
              <div style={{ color: "#6B7280", fontSize: 14 }}>
                התחיל: {dateLabel(syncRun.started_at)} | חדשות ל־pending: {syncRun.total_new_pending} | מהזיכרון: {syncRun.total_classified_from_memory} | מ־AI: {syncRun.total_classified_from_ai}
              </div>
              {syncRun.error_summary && <div style={{ color: "#991B1B", fontSize: 14 }}>{syncRun.error_summary}</div>}
            </div>
          </Card>
        )}

        <div style={{ marginTop: 16, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, color: "#202125" }}>{pendingCount} רשומות ממתינות</div>
          <div style={{ color: "#6B7280", fontSize: 14 }}>בבחירת קטגוריה אפשר לתקן לפני אישור.</div>
        </div>

        {(authLoading || loading) && <div style={{ padding: 40, textAlign: "center" }}>טוען…</div>}
        {error && <div style={{ padding: 16, marginBottom: 12, borderRadius: 12, background: "#FEE2E2", color: "#991B1B" }}>{error}</div>}
        {message && <div style={{ padding: 16, marginBottom: 12, borderRadius: 12, background: "#DCFCE7", color: "#166534" }}>{message}</div>}

        {!authLoading && !loading && !!user && groupedByMonth.length === 0 && (
          <Card>
            <div style={{ padding: 28, textAlign: "center", color: "#6B7280" }}>אין כרגע רשומות ממתינות.</div>
          </Card>
        )}

        <div style={{ display: "grid", gap: 16 }}>
          {groupedByMonth.map(([group, items]) => (
            <Card key={group}>
              <div style={{ padding: 16, borderBottom: "1px solid #E8E6E3", fontWeight: 800 }}>
                {group} <span style={{ color: "#6B7280", fontWeight: 500 }}>({items.length} רשומות)</span>
              </div>
              <div style={{ display: "grid" }}>
                {items.map((row) => (
                  <div
                    key={row.id}
                    style={{
                      padding: 16,
                      borderTop: "1px solid #E8E6E3",
                      display: "grid",
                      gap: 12,
                      background: "#fff",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 800, color: "#202125" }}>{row.business_name || "ללא שם"}</div>
                        <div style={{ color: "#6B7280", fontSize: 14 }}>
                          {dateLabel(row.payment_date)} | {row.payment_method || "ללא מקור"} | {row.source_category || "ללא קטגוריה מקורית"}
                        </div>
                      </div>
                      <div style={{ fontWeight: 800, color: row.amount < 0 ? "#B91C1C" : "#166534", direction: "ltr" }}>
                        {amountLabel(row.amount)}
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      <label style={{ fontSize: 13, color: "#6B7280" }}>קטגוריה</label>
                      <select
                        value={row.category_name || "אחר"}
                        onChange={(event) => updateCategory(row.id, event.target.value)}
                        disabled={savingId === row.id}
                        style={{
                          width: "100%",
                          borderRadius: 12,
                          border: "1px solid #D1D5DB",
                          padding: "12px 14px",
                          fontFamily: "inherit",
                          background: "#fff",
                        }}
                      >
                        {categories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </div>

                    {row.notes && <div style={{ fontSize: 13, color: "#6B7280" }}>{row.notes}</div>}

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button className="flex-row-reverse gap-2" onClick={() => approveRow(row)} disabled={savingId === row.id}>
                        <Check className="h-4 w-4" />
                        אשר והכנס לאתר
                      </Button>
                      <Button variant="outline" className="flex-row-reverse gap-2" onClick={() => dismissRow(row.id)} disabled={savingId === row.id}>
                        <X className="h-4 w-4" />
                        דחה
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
