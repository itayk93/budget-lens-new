import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadAll, buildMonth, primaryCashFlow, updateTransaction, splitTransaction, unsplitTransaction, saveMonthlyTarget, deleteTransaction, weekRemaining, MonthModel, Txn, Category, CashFlow, CategoryOrder, SharedCategoryTarget, MonthlyTarget, MonthlyGoal, TransactionSplitInput, RISE } from "@/riseup/compute";
import { categoryHistory, ensureMonthPlan, suggestFromHistory } from "@/riseup/monthlyPlan";
import EditCategoryTargetSheet from "@/components/EditCategoryTargetSheet";
import { importTransactionsCsv } from "@/riseup/importTransactionsCsv";
import { Money, Bar, Card, CardHeader, Collapsible, TxnRow, BudgetCard, TxnEditContext, TxnEditSheet, SummaryAmountCard } from "@/riseup/components";
import TransactionImportDialog from "@/components/TransactionImportDialog";
import MonthActionsSheet from "@/components/MonthActionsSheet";
import AppLoadingScreen from "@/components/AppLoadingScreen";

const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
function monthLabel(m: string) {
  const [y, mm] = m.split("-");
  return { name: HE_MONTHS[Number(mm) - 1], year: y };
}

const LOAD_ATTEMPT_TIMEOUT_MS = 15_000;

function withDeadline<T>(promise: Promise<T>, timeoutMs = LOAD_ATTEMPT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(
      () => reject(new Error("טעינת הנתונים ארכה יותר מדי זמן")),
      timeoutMs
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

async function loadAllWithRetry(attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withDeadline(loadAll());
    } catch (error) {
      lastError = error;
      console.error(`[budget] Load attempt ${attempt + 1}/${attempts} failed`, error);
      if (attempt < attempts - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/* top bar: icons on the RIGHT, sparkle logo on the LEFT (matches Riseup) */
function HeaderBar({ onOpenImport, onOpenMenu, onOpenSearch, importing }: { onOpenImport: () => void; onOpenMenu: () => void; onOpenSearch: () => void; importing: boolean }) {
  return (
    <div style={{ display: "flex", minHeight: 58, alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: `1px solid ${RISE.grayLine}`, position: "sticky", top: 0, zIndex: 10, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button aria-label="תפריט" onClick={onOpenMenu} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={RISE.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <button aria-label="סינון" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={RISE.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, justifyContent: "flex-end" }}>
        <button type="button" aria-label="חיפוש בתזרים" onClick={onOpenSearch} style={{ background: RISE.cream, borderRadius: 99, display: "flex", alignItems: "center", padding: "5px 12px", width: "100%", maxWidth: 146, border: "none", cursor: "text" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={RISE.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </button>
        <button type="button" onClick={onOpenImport} disabled={importing} style={{ background: "none", border: "none", padding: 0, cursor: importing ? "wait" : "pointer", opacity: importing ? 0.55 : 1, display: "flex" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={RISE.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></svg>
        </button>
        <div style={{ width: 32, height: 32, borderRadius: 9, overflow: "hidden", border: `1px solid ${RISE.grayLine}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src="/favicon.png" alt="Budget Lens" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      </div>
    </div>
  );
}

function SearchSheet({ query, onQueryChange, results, onSelect, onClose }: { query: string; onQueryChange: (q: string) => void; results: Txn[]; onSelect: (txn: Txn) => void; onClose: () => void }) {
  return <div role="dialog" aria-label="חיפוש בתזרים" dir="rtl" style={{ position: "fixed", top: 0, bottom: 0, left: "50%", transform: "translateX(-50%)", width: "min(100%, 400px)", zIndex: 40, background: "#fff", display: "flex", flexDirection: "column", fontFamily: "Heebo, sans-serif", boxShadow: "0 2px 12px rgba(0,0,0,.12)" }}>
    <div style={{ display: "flex", direction: "ltr", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${RISE.grayLine}` }}>
      <button type="button" aria-label="סגירת חיפוש" onClick={onClose} style={{ border: "none", background: "none", fontSize: 24, cursor: "pointer", color: RISE.ink }}>×</button>
      <input autoFocus value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="חיפוש בתזרים" dir="rtl" style={{ flex: 1, border: "none", outline: "none", fontFamily: "inherit", fontSize: 18, color: RISE.ink, textAlign: "right" }} />
    </div>
    {query.trim() && <div style={{ padding: "18px 20px", color: RISE.gray, fontSize: 14 }}>{results.length ? `נמצאו ${results.length} עסקאות` : "לא נמצאו עסקאות תואמות"}</div>}
    <div style={{ overflowY: "auto" }}>
      {results.map((t) => <button key={t.id} type="button" onClick={() => onSelect(t)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "14px 22px", border: "none", borderTop: `1px solid ${RISE.grayLine}`, background: RISE.cardGray, textAlign: "start", cursor: "pointer", fontFamily: "inherit" }}>
        <span dir="ltr" style={{ minWidth: 58, color: RISE.ink, fontSize: 14 }}>{t.payment_date ? `${Number(t.payment_date.slice(8, 10))}.${Number(t.payment_date.slice(5, 7))}.${t.payment_date.slice(2, 4)}` : ""}</span>
        <span style={{ flex: 1 }}><span style={{ display: "block", fontWeight: 700, color: RISE.ink }}><Money value={Math.abs(t.amount)} /></span><span dir="auto" style={{ display: "block", marginTop: 3, color: RISE.ink }}>{t.business_name}{t.payment_method ? ` ${t.payment_method}` : ""}</span></span>
      </button>)}
    </div>
  </div>;
}

function MonthNav({ month, months, onChange }: { month: string; months: string[]; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const { name, year } = monthLabel(month);
  const idx = months.indexOf(month);
  const arrow = (d: string, dis: boolean, onClick: () => void, label: string) => (
    <button aria-label={label} disabled={dis} onClick={onClick} style={{ background: "none", border: "none", cursor: dis ? "default" : "pointer", opacity: dis ? 0.25 : 1, padding: 6 }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={RISE.ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
    </button>
  );
  return (
    <div dir="rtl" style={{ position: "relative", display: "flex", minHeight: 88, alignItems: "center", justifyContent: "space-between", padding: "14px 22px", background: "#fff", borderBottom: `1px solid ${RISE.grayLine}` }}>
      {arrow("M9 6l6 6-6 6", idx <= 0, () => idx > 0 && onChange(months[idx - 1]), "חודש קודם")}
      <button type="button" aria-expanded={open} aria-label="בחירת חודש" onClick={() => setOpen((value) => !value)} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 22, fontWeight: 700, color: RISE.ink, background: "none", border: 0, cursor: "pointer", padding: "12px 18px", borderRadius: 12 }}>
        <span>{name}</span>
        <span dir="ltr" style={{ fontWeight: 400 }}>{year}</span>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={RISE.ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease" }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {arrow("M15 6l-6 6 6 6", idx >= months.length - 1, () => idx < months.length - 1 && onChange(months[idx + 1]), "חודש הבא")}
      {open && <div role="listbox" aria-label="חודשים" style={{ position: "absolute", zIndex: 20, top: "calc(100% - 5px)", left: "50%", transform: "translateX(-50%)", width: "min(260px, calc(100% - 44px))", maxHeight: 280, overflowY: "auto", padding: 7, border: `1px solid ${RISE.grayLine}`, borderRadius: 14, background: "#fff", boxShadow: "0 12px 28px rgba(32,33,37,.14)" }}>
        {months.slice().reverse().map((option) => {
          const optionLabel = monthLabel(option);
          const selected = option === month;
          return <button key={option} type="button" role="option" aria-selected={selected} onClick={() => { onChange(option); setOpen(false); }} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 12px", border: 0, borderRadius: 9, background: selected ? RISE.cream : "transparent", color: RISE.ink, fontFamily: "inherit", fontSize: 16, fontWeight: selected ? 700 : 500, cursor: "pointer" }}><span>{optionLabel.name}</span><span dir="ltr">{optionLabel.year}</span></button>;
        })}
      </div>}
    </div>
  );
}


/* finished-month summary card — "{חודש} הסתיים בתזרים חיובי/שלילי ±N ₪" */
function SummaryCard({ monthName, income, expenses }: { monthName: string; income: number; expenses: number }) {
  const net = income - expenses;
  const positive = net >= 0;
  const netColor = positive ? RISE.green : RISE.orange;
  return (
    <Card>
      <div style={{ padding: "20px 22px 22px" }}>
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <button aria-label="שיתוף" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={RISE.ink} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
          </button>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: RISE.ink, margin: "4px 0 0", textAlign: "start", lineHeight: 1.4 }}>
          {monthName} הסתיים בתזרים {positive ? "חיובי" : "שלילי"}
        </h2>
        <div style={{ margin: "18px 0 6px", textAlign: "start" }}>
          <span dir="ltr" style={{ fontSize: 54, fontWeight: 500, color: netColor, whiteSpace: "nowrap", unicodeBidi: "isolate" }}>
            <span style={{ marginInlineEnd: 4 }}>₪</span>
            {positive ? "" : "-"}{Math.round(Math.abs(net)).toLocaleString("en-US")}
          </span>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${RISE.grayLine}`, padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: RISE.gray, fontSize: 15 }}>סה״כ הכנסות</span>
        <span dir="ltr" style={{ fontSize: 16, fontWeight: 700, color: RISE.ink, unicodeBidi: "isolate" }}>+ ₪{Math.round(income).toLocaleString("en-US")}</span>
      </div>
      <div style={{ borderTop: `1px solid ${RISE.grayLine}`, padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: RISE.gray, fontSize: 15 }}>סה״כ הוצאות</span>
        <span dir="ltr" style={{ fontSize: 16, fontWeight: 700, color: RISE.orange, unicodeBidi: "isolate" }}>- ₪{Math.round(expenses).toLocaleString("en-US")}</span>
      </div>
    </Card>
  );
}

function AddCategory() {
  return (
    <button style={{ width: "100%", margin: "18px 0", padding: "24px 18px", background: "transparent", border: `2px dashed ${RISE.blue}`, borderRadius: 18, color: RISE.blue, fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
      <span>הוספת קטגוריה למעקב</span>
      <span style={{ background: RISE.blue, color: "#fff", borderRadius: 99, width: 32, height: 32, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>+</span>
    </button>
  );
}

/* generic colored "summary" card head used for variable / income (custom amount labels) */
function ThemedCard({
  title, leftLabel, leftValue, rightLabel, rightValue, rightColor, track, fill, footer, children,
}: {
  title: string; leftLabel: string; leftValue: number; rightLabel: string; rightValue: number;
  rightColor: string; track: string; fill: string; footer?: ReactFooter; children?: any;
}) {
  return (
    <Card>
      <div style={{ padding: "22px 22px 20px" }}>
        <CardHeader title={title} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12 }}>
          <div style={{ textAlign: "start" }}>
            <div style={{ color: RISE.gray, fontSize: 12, marginBottom: 2 }}>{rightLabel}</div>
            <Money value={rightValue} style={{ fontSize: 18, color: rightColor, fontWeight: 700 }} />
          </div>
          <div style={{ textAlign: "end" }}>
            <div style={{ color: RISE.gray, fontSize: 12, marginBottom: 2 }}>{leftLabel}</div>
            <Money value={leftValue} style={{ fontSize: 18, color: RISE.ink, fontWeight: 400 }} />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <Bar pct={(rightValue / Math.max(leftValue, 1)) * 100} track={track} fill={fill} />
        </div>
      </div>
      {children}
    </Card>
  );
}
type ReactFooter = any;

export default function Index() {
  const navigate = useNavigate();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [cashFlows, setCashFlows] = useState<CashFlow[]>([]);
  const [categoryOrder, setCategoryOrder] = useState<CategoryOrder[]>([]);
  const [sharedTargets, setSharedTargets] = useState<SharedCategoryTarget[]>([]);
  const [monthlyTargets, setMonthlyTargets] = useState<MonthlyTarget[]>([]);
  const [monthlyGoals, setMonthlyGoals] = useState<MonthlyGoal[]>([]);
  const [editTarget, setEditTarget] = useState<{ name: string; current: number; spent: number } | null>(null);
  const [month, setMonth] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Txn | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ parsed: number; inserted: number; skipped: number; months: string[] } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const categoryNames = useMemo(() => {
    const s = new Set<string>();
    for (const t of txns) if (t.category_name) s.add(t.category_name);
    for (const c of cats) if (c.name) s.add(c.name);
    return Array.from(s).sort((a, b) => a.localeCompare(b, "he"));
  }, [txns, cats]);

  const saveEdit = async (patch: Partial<Txn>) => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateTransaction(editing.id, patch);
      setTxns((prev) => prev.map((x) => (x.id === editing.id ? { ...x, ...patch } : x)));
      setEditing(null);
    } catch (e: any) {
      setError(e.message || "שמירה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const splitEdit = async (splits: TransactionSplitInput[]) => {
    if (!editing) return;
    setSaving(true);
    try {
      await splitTransaction(editing, splits);
      // Reload everything to get the new transactions from DB
      const fresh = await loadAllWithRetry();
      setTxns(fresh.txns);
      setEditing(null);
    } catch (e: any) {
      setError(e.message || "פיצול נכשל");
    } finally {
      setSaving(false);
    }
  };

  const unsplitEdit = async () => {
    if (!editing) return;
    const confirmed = window.confirm("לבטל את הפיצול ולהחזיר את העסקה המקורית?");
    if (!confirmed) return;

    setSaving(true);
    try {
      const restored = await unsplitTransaction(editing, txns);
      const fresh = await loadAllWithRetry();
      setTxns(fresh.txns);
      setEditing(null);
      setImportMessage(`הפיצול בוטל והעסקה המקורית (${Math.abs(restored?.amount || 0)} ₪) הוחזרה בהצלחה לקטגוריית "${restored?.category_name || "הוצאות"}"!`);
    } catch (e: any) {
      setError(e.message || "ביטול הפיצול נכשל");
    } finally {
      setSaving(false);
    }
  };

  const deleteEditing = async () => {
    if (!editing) return;

    setSaving(true);
    try {
      const result = await deleteTransaction(editing.id);
      setTxns((prev) => prev.filter((x) => x.id !== editing.id));
      setEditing(null);
      setImportMessage(result.ignored ? "הרשומה נמחקה ותסומן כדי לא לחזור בהורדה יומית." : "הרשומה נמחקה.");
    } catch (e: any) {
      setError(e.message || "מחיקת הרשומה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const handleImportCsv = async (file: File) => {
    setError(null);
    setImportMessage(null);
    setImportFile(file);
  };

  const startImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setError(null);
    setImportMessage(null);
    try {
      const text = await importFile.text();
      const result = await importTransactionsCsv(text);
      setImportResult({ parsed: result.parsed, inserted: result.inserted, skipped: result.skipped, months: result.months });
      const importedMonth = result.months[0];
      if (importedMonth) {
        const fresh = await loadAllWithRetry();
        setTxns(fresh.txns);
        setCats(fresh.cats);
        setCashFlows(fresh.cashFlows);
        setCategoryOrder(fresh.categoryOrder);
        setSharedTargets(fresh.sharedTargets);
        setMonthlyTargets(fresh.monthlyTargets);
        setMonthlyGoals(fresh.monthlyGoals);
        setMonth(importedMonth);
      }
      setImportMessage(`יובאו ${result.inserted} רשומות. דולגו ${result.skipped} רשומות שכבר קיימות.`);
      setImportOpen(false);
      setImportFile(null);
    } catch (e: any) {
      setError(e.message || "ייבוא הקובץ נכשל");
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    loadAllWithRetry()
      .then(async ({ txns, cats, cashFlows, categoryOrder, sharedTargets, monthlyTargets, monthlyGoals }) => {
        setTxns(txns);
        setCats(cats);
        setCashFlows(cashFlows);
        setCategoryOrder(categoryOrder);
        setSharedTargets(sharedTargets);
        setMonthlyGoals(monthlyGoals);
        const cf = primaryCashFlow(txns, cashFlows);
        const flow = cf ? txns.filter((t) => t.cash_flow_id === cf) : txns;
        const months = Array.from(new Set(flow.map((t) => t.flow_month).filter(Boolean) as string[])).sort();
        const latest = months[months.length - 1] || "";
        setMonth(latest);

        // Start-of-month rollover: a month that has never been planned gets one now —
        // income and fixed carried forward, variable categories left empty.
        const userId = cf ? cashFlows.find((f) => f.id === cf)?.user_id : null;
        let plan = monthlyTargets;
        if (userId && cf && latest) {
          try {
            const seeded = await ensureMonthPlan({ userId, cashFlowId: cf, month: latest, txns, categoryOrder, sharedTargets, monthlyTargets });
            if (seeded.length) plan = [...monthlyTargets, ...seeded];
          } catch {
            // A failed seed just means this month falls back to the global targets.
          }
        }
        setMonthlyTargets(plan);
      })
      .catch((e) => setError(e.message || "שגיאה בטעינת הנתונים"))
      .finally(() => setLoading(false));
  }, []);

  const model: MonthModel | null = useMemo(
    () => (month && txns.length ? buildMonth(month, txns, cats, cashFlows, categoryOrder, sharedTargets, monthlyTargets, monthlyGoals) : null),
    [month, txns, cats, cashFlows, categoryOrder, sharedTargets, monthlyTargets, monthlyGoals]
  );
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const isFinishedMonth = Boolean(month && month < currentMonth);
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase();
    if (!q) return [];
    return txns.filter((t) => [t.business_name, t.payment_method, t.notes, t.category_name, t.amount].some((value) => String(value ?? "").toLocaleLowerCase().includes(q))).slice(0, 100);
  }, [searchQuery, txns]);

  // Keep the initial app loader on screen until the dashboard data is ready.
  if (loading) return <AppLoadingScreen />;

  const saveTarget = async (amount: number) => {
    if (!editTarget || !model?.userId || !model.cashFlowId) return;
    setSaving(true);
    try {
      await saveMonthlyTarget(model.userId, model.cashFlowId, month, editTarget.name, amount);
      setMonthlyTargets((prev) => {
        const rest = prev.filter((t) => !(t.flow_month === month && t.category_name === editTarget.name && t.cash_flow_id === model.cashFlowId));
        return [...rest, { id: `${month}-${editTarget.name}`, user_id: model.userId!, cash_flow_id: model.cashFlowId!, category_name: editTarget.name, flow_month: month, amount, is_suggestion: false }];
      });
      setEditTarget(null);
    } catch (e: any) {
      setError(e.message || "שמירת הסכום נכשלה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <TxnEditContext.Provider value={setEditing}>
    <div className="budget-lens-page" style={{ background: RISE.pageBg, minHeight: "100vh", fontFamily: "Heebo, sans-serif", direction: "rtl", display: "flex", justifyContent: "center" }}>
      <style>{`.num{font-size:18px;font-weight:700;color:${RISE.ink}} *{box-sizing:border-box} .txn-row:hover { background-color: #e8e6e3 !important; }`}</style>
      {editing && <TxnEditSheet txn={editing} categories={categoryNames} onClose={() => setEditing(null)} onSave={saveEdit} onSplit={splitEdit} onUnsplit={unsplitEdit} onDelete={deleteEditing} saving={saving} />}
      {searchOpen && <SearchSheet query={searchQuery} onQueryChange={setSearchQuery} results={searchResults} onSelect={(txn) => { setSearchOpen(false); setSearchQuery(""); setEditing(txn); }} onClose={() => { setSearchOpen(false); setSearchQuery(""); }} />}
      {editTarget && (
        <EditCategoryTargetSheet
          categoryName={editTarget.name}
          month={month}
          current={editTarget.current}
          spent={editTarget.spent}
          suggestion={suggestFromHistory(txns, model?.cashFlowId ?? null, editTarget.name, month)}
          history={categoryHistory(txns, model?.cashFlowId ?? null, editTarget.name, month)}
          saving={saving}
          onClose={() => setEditTarget(null)}
          onSave={saveTarget}
        />
      )}
      {/* A real 400px cashflow canvas, matching Riseup without browser zoom.
          It scrolls internally so the sticky header remains inside the frame. */}
      <div className="app-frame">
        <HeaderBar onOpenImport={() => setImportOpen(true)} onOpenMenu={() => setMenuOpen(true)} onOpenSearch={() => setSearchOpen(true)} importing={importing} />
        <MonthActionsSheet
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onOpenMonths={() => {
            setMenuOpen(false);
            navigate("/months");
          }}
          onOpenPending={() => {
            setMenuOpen(false);
            navigate("/pending-transactions");
          }}
          onOpenFoodMap={() => {
            setMenuOpen(false);
            navigate("/food-map");
          }}
          onOpenFlights={() => {
            setMenuOpen(false);
            navigate("/flights");
          }}
          onOpenImport={() => {
            setMenuOpen(false);
            setImportOpen(true);
          }}
        />
        <TransactionImportDialog
          open={importOpen}
          file={importFile}
          loading={importing}
          error={error}
          result={importResult}
          onPickFile={handleImportCsv}
          onClose={() => {
            if (!importing) {
              setImportOpen(false);
              setImportFile(null);
              setImportResult(null);
            }
          }}
          onStart={startImport}
        />
        {model && <MonthNav month={month} months={model.months} onChange={setMonth} />}

        <div className="cashflow-content" style={{ background: RISE.cream }}>
          {error && (
            <div role="alert" style={{ textAlign: "center", padding: "56px 24px", color: RISE.ink }}>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>לא הצלחנו לטעון את הנתונים</div>
              <div style={{ color: RISE.gray, fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>בדוק את החיבור לאינטרנט ונסה שוב.</div>
              <button type="button" onClick={() => window.location.reload()} style={{ minHeight: 46, padding: "0 22px", border: 0, borderRadius: 999, background: RISE.blue, color: "#fff", fontFamily: "inherit", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>נסה שוב</button>
            </div>
          )}
          {!error && !model && (
            <div style={{ textAlign: "center", padding: "60px 20px", color: RISE.gray, lineHeight: 1.8 }}>
              <div style={{ color: RISE.ink, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>אין עדיין תנועות להצגה</div>
              <div style={{ fontSize: 14 }}>אפשר לייבא קובץ תנועות מהתפריט למעלה.</div>
            </div>
          )}
          {importMessage && <div style={{ margin: "12px 0", padding: 12, borderRadius: 10, background: RISE.greenSoft, color: RISE.greenDark, fontSize: 14, textAlign: "start" }}>{importMessage}</div>}

          {model && (
            <>
              {(() => {
                const v = model.variableBucket;
                if (isFinishedMonth) {
                  return (
                    <>
                      <SummaryCard monthName={monthLabel(month).name} income={model.income.got} expenses={model.totalSpent} />
                      <BudgetCard
                        title="הוצאות משתנות"
                        spent={v.spent}
                        expected={v.spent}
                        fill={RISE.yellow}
                        track={RISE.yellowSoft}
                        amountColor={RISE.yellowText}
                        detailLabel="פירוט הוצאות משתנות"
                        txns={v.txns}
                        expectedLabel="הוצא בפועל"
                        weekly={false}
                        month={month}
                        group={v}
                        defaultOpen={true}
                        finished
                      />
                    </>
                  );
                }
                // Riseup's headline figure: this week's slice of the variable-expenses
                // budget minus what already went out during this week.
                const leftThisWeek = weekRemaining(v.txns, month, v.expected);
                return (
                  <>
                    <SummaryAmountCard name="איתי" amount={Math.max(0, leftThisWeek)} />

                    <BudgetCard
                      title="הוצאות משתנות"
                      spent={v.spent}
                      expected={v.expected}
                      fill={RISE.yellow}
                      track={RISE.yellowSoft}
                      amountColor={RISE.yellowText}
                      detailLabel="פירוט הוצאות משתנות"
                      txns={v.txns}
                      expectedLabel="מומלץ להוציא עד"
                      weekly={true}
                      month={month}
                      group={v}
                      defaultOpen={true}
                    />

                  </>
                );
              })()}

              {/* tracked variable categories (blue) */}
              {model.trackedVariable.map((g) => (
                <BudgetCard key={g.name} title={g.name} spent={g.spent} expected={isFinishedMonth ? g.spent : g.expected} fill={RISE.blue} track={RISE.blueSoft} amountColor={RISE.blue} detailLabel={g.weeklyDisplay && !isFinishedMonth ? "פירוט שבועי" : "פירוט חודשי"} txns={g.txns} weekly={g.weeklyDisplay && !isFinishedMonth} month={month} group={g} onEdit={() => setEditTarget({ name: g.name, current: g.expected, spent: g.spent })} finished={isFinishedMonth} />
              ))}

              <AddCategory />

              {/* savings (orange) — aggregated like Riseup's "הפקדות לחיסכון" */}
              {model.savings.groups.length > 0 && (
                <BudgetCard title="הפקדות לחיסכון" spent={model.savings.total} expected={isFinishedMonth ? model.savings.total : model.savings.expected} fill={RISE.orange} track={RISE.orangeSoft} amountColor={RISE.orange} detailLabel="הפקדות קבועות" subGroups={model.savings.groups} txns={model.savings.groups.flatMap((g) => g.txns)} expectedLabel="צפוי לצאת" finished={isFinishedMonth} />
              )}

              {/* fixed expenses (pink) */}
              {model.fixed.groups.length > 0 && (
                <BudgetCard title="הוצאות קבועות" spent={model.fixed.total} expected={isFinishedMonth ? model.fixed.total : model.fixed.expected} fill={RISE.pink} track={RISE.pinkSoft} amountColor={RISE.pink} detailLabel="פירוט חודשי" subGroups={model.fixed.groups} txns={model.fixed.groups.flatMap((g) => g.txns)} finished={isFinishedMonth} />
              )}

              {/* summary banner */}
              <Card>
                <div style={{ padding: "26px 24px" }}>
                  <p style={{ fontSize: 16, fontWeight: 500, color: RISE.ink, margin: 0, lineHeight: 1.7, textAlign: "start" }}>
                    {isFinishedMonth ? (
                      <>סך כל ההוצאות בחודש <span style={{ color: RISE.orange, fontWeight: 700 }}><Money value={model.totalSpent} style={{ fontSize: 24 }} /></span>.</>
                    ) : (
                      <>סך כל ההוצאות עד עכשיו <span style={{ color: RISE.orange, fontWeight: 700 }}><Money value={model.totalSpent} style={{ fontSize: 24 }} /></span> מתוך <span style={{ color: RISE.orange, fontWeight: 700 }}><Money value={model.totalExpected} style={{ fontSize: 24 }} /></span> שצפויים לצאת.</>
                    )}
                  </p>
                </div>
              </Card>

              {/* income (green) */}
              <BudgetCard
                title="הכנסות"
                spent={model.income.got}
                expected={isFinishedMonth ? model.income.got : model.income.expected}
                fill={RISE.green}
                track={RISE.greenSoft}
                amountColor={RISE.green}
                detailLabel="פירוט הכנסות"
                txns={[...model.income.fixed.flatMap((g) => g.txns), ...model.income.variable.flatMap((g) => g.txns)]}
                expectedLabel="צפי הכנסות"
                finished={isFinishedMonth}
              />

              {/* not in cash-flow */}
              <Card>
                <div style={{ padding: "22px 22px 6px" }}>
                  <CardHeader title="לא בתזרים" />
                </div>
                <Collapsible label="פירוט הכנסות לא תזרימיות" amount={model.notInFlow.incomeTotal}>
                  {model.notInFlow.incomeTxns.map((t) => <TxnRow key={t.id} t={t} />)}
                </Collapsible>
                <Collapsible label="פירוט הוצאות לא תזרימיות" amount={model.notInFlow.expenseTotal}>
                  {model.notInFlow.expenseTxns.map((t) => <TxnRow key={t.id} t={t} />)}
                </Collapsible>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
    </TxnEditContext.Provider>
  );
}
