import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/riseup/components";
import { deleteTransactionsMonths } from "@/riseup/importTransactionsCsv";
import { loadAll, primaryCashFlow, Txn, CashFlow, RISE } from "@/riseup/compute";
import { ArrowRight, CheckSquare, Square, Trash2 } from "lucide-react";

function monthLabel(month: string) {
  const [year, mm] = month.split("-");
  const names = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  return `${names[Number(mm) - 1]} ${year}`;
}

export default function MonthsManager() {
  const navigate = useNavigate();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [cashFlows, setCashFlows] = useState<CashFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadAll()
      .then(({ txns, cashFlows }) => {
        setTxns(txns);
        setCashFlows(cashFlows);
      })
      .catch((e) => setError(e.message || "שגיאה בטעינת החודשים"))
      .finally(() => setLoading(false));
  }, []);

  const months = useMemo(() => {
    const cf = primaryCashFlow(txns, cashFlows);
    const flow = cf ? txns.filter((t) => t.cash_flow_id === cf) : txns;
    return Array.from(new Set(flow.map((t) => t.flow_month).filter(Boolean) as string[]))
      .sort()
      .reverse()
      .map((month) => ({
        month,
        count: flow.filter((t) => t.flow_month === month).length,
        total: flow.filter((t) => t.flow_month === month).reduce((sum, t) => sum + Math.abs(t.amount), 0),
      }));
  }, [txns, cashFlows]);

  const allSelected = months.length > 0 && selected.length === months.length;

  const toggleMonth = (month: string) => {
    setSelected((prev) => (prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month]));
  };

  const handleDelete = async () => {
    if (!selected.length) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await deleteTransactionsMonths(selected);
      setMessage(`נמחקו ${result.deleted} רשומות מתוך ${selected.length} חודשים.`);
      setSelected([]);
      const fresh = await loadAll();
      setTxns(fresh.txns);
      setCashFlows(fresh.cashFlows);
    } catch (e: any) {
      setError(e.message || "מחיקה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: RISE.cream, fontFamily: "Heebo, sans-serif", textAlign: "right" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", background: "#fff", minHeight: "100vh", padding: 16, boxShadow: "0 0 30px rgba(0,0,0,0.06)", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, direction: "rtl" }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#202125", textAlign: "right" }}>ניהול חודשים</h1>
          <Button variant="ghost" className="flex-row-reverse gap-2" onClick={() => navigate("/")}>
            <ArrowRight className="h-4 w-4" />
            חזרה
          </Button>
        </div>

        {loading && <div style={{ padding: 40, textAlign: "center" }}>טוען…</div>}
        {error && <div style={{ padding: 16, marginBottom: 12, borderRadius: 12, background: "#FEE2E2", color: "#991B1B" }}>{error}</div>}
        {message && <div style={{ padding: 16, marginBottom: 12, borderRadius: 12, background: "#DCFCE7", color: "#166534" }}>{message}</div>}

        <Card>
          <div style={{ padding: 16, borderBottom: "1px solid #E8E6E3", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", direction: "rtl" }}>
            <div style={{ fontWeight: 700, textAlign: "right" }}>בחר חודשים למחיקה</div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="outline" className="flex-row-reverse gap-2" onClick={() => setSelected(months.map((m) => m.month))} disabled={allSelected}>
                <CheckSquare className="h-4 w-4" />
                הכל
              </Button>
              <Button variant="outline" className="flex-row-reverse gap-2" onClick={() => setSelected([])} disabled={!selected.length}>
                <Square className="h-4 w-4" />
                נקה
              </Button>
            </div>
          </div>
          <div>
            {months.map((item) => (
              <button
                key={item.month}
                onClick={() => toggleMonth(item.month)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px 18px",
                  border: "none",
                  borderTop: "1px solid #E8E6E3",
                  background: selected.includes(item.month) ? "#DCE8F6" : "#fff",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, direction: "rtl" }}>
                  {selected.includes(item.month) ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, color: "#202125" }}>{monthLabel(item.month)}</div>
                    <div style={{ fontSize: 13, color: "#8E8C8C" }}>{item.count} רשומות</div>
                  </div>
                </div>
                <div style={{ fontWeight: 700, color: "#202125", textAlign: "left", direction: "ltr" }}>{Math.round(item.total).toLocaleString("en-US")} ₪</div>
              </button>
            ))}
          </div>
        </Card>

        <div style={{ position: "sticky", bottom: 16, marginTop: 16 }}>
          <Button
            className="w-full"
            variant="destructive"
            onClick={handleDelete}
            disabled={!selected.length || saving}
            style={{ height: 56, fontSize: 16, fontWeight: 800 }}
          >
            <Trash2 className="h-4 w-4" />
            {saving ? "מוחק..." : `מחק ${selected.length} חודשים`}
          </Button>
        </div>
      </div>
    </div>
  );
}
