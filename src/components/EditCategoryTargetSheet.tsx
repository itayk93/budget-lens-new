import { useEffect, useState } from "react";
import { RISE } from "@/riseup/compute";
import { Money } from "@/riseup/components";
import type { CategoryHistoryPoint } from "@/riseup/monthlyPlan";

/**
 * Riseup's "עריכת סכום" sheet: reached from a category's kebab menu, it sets the
 * forecast for THIS month only. The three-month average is offered as a suggestion
 * rather than applied automatically, because a category that was a one-off should not
 * keep being budgeted.
 */
export default function EditCategoryTargetSheet({
  categoryName, month, current, spent, suggestion, history, saving, onClose, onSave,
}: {
  categoryName: string;
  month: string;
  current: number;
  spent: number;
  suggestion: number;
  history: CategoryHistoryPoint[];
  saving: boolean;
  onClose: () => void;
  onSave: (amount: number) => void;
}) {
  const [value, setValue] = useState(String(Math.round(current * 100) / 100));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsed = Number(value.replace(/,/g, ""));
  const valid = Number.isFinite(parsed) && parsed >= 0;
  const [y, m] = month.split("-");
  const monthLabel = `${["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"][Number(m) - 1]} ${y}`;
  const [mode, setMode] = useState<"automatic" | "personal">("personal");
  const [onlyThisMonth, setOnlyThisMonth] = useState(false);
  const chart = history.length ? history : [{ label: "", amount: 0 }];
  const chartMax = Math.max(1, ...chart.map(({ amount }) => amount));

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,35,46,.78)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "9vh", boxSizing: "border-box", zIndex: 60 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
        className="edit-category-sheet-scroll"
        style={{ position: "relative", background: "#fff", width: "calc(100% - 60px)", maxWidth: 405, borderRadius: 24, maxHeight: "91vh", overflowY: "auto", fontFamily: "Heebo, sans-serif", padding: "22px 28px 24px", boxSizing: "border-box", zoom: 0.84 }}
      >
        <button type="button" onClick={onClose} aria-label="סגירה" style={{ position: "absolute", top: 7, insetInlineEnd: 17, border: 0, background: "none", color: "#505158", fontSize: 48, lineHeight: 1, fontWeight: 300, cursor: "pointer" }}>×</button>
        <h2 style={{ margin: "30px 0 21px", fontSize: 24, lineHeight: 1.2, fontWeight: 800 }}>כמה כסף צפוי לצאת על {categoryName} ב{monthLabel.split(" ")[0]}?</h2>
        <section aria-label="צפי אוטומטי לפי העבר" onClick={() => suggestion > 0 && (setMode("automatic"), setValue(String(Math.round(suggestion * 100) / 100)))} style={{ border: `2px solid ${mode === "automatic" ? "#5B78F6" : RISE.grayLine}`, borderRadius: 20, padding: "32px 20px 20px", opacity: mode === "automatic" ? 1 : suggestion > 0 ? .55 : .4, minHeight: 300, boxSizing: "border-box", cursor: suggestion > 0 ? "pointer" : "default" }}>
          <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 14, fontSize: 17, fontWeight: 800, color: "#C8C8CC" }}><span style={{ width: 24, height: 24, flexShrink: 0, border: "2px solid #BFC0C5", borderRadius: "50%", display: "grid", placeItems: "center" }}>{mode === "automatic" && <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#5B78F6" }} />}</span><span>צפי אוטומטי לפי העבר</span></div>
          <div style={{ marginTop: 10, marginInlineStart: 48, textAlign: "right", fontSize: 40, fontWeight: 800, color: "#D6D6D9", position: "relative", zIndex: 1 }}><Money value={suggestion} /></div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, height: 212, borderBottom: `2px solid ${RISE.grayLine}`, marginTop: 28 }}>
            {chart.map(({ label, amount }) => <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 8 }}><span>{Math.round(amount)}</span><div style={{ width: "100%", maxWidth: 42, height: `${Math.max(24, (amount / chartMax) * 122)}px`, borderRadius: "22px 22px 0 0", background: "#D8E5F6" }} /><span style={{ color: "#C8C8CC", whiteSpace: "nowrap" }}>{label}</span></div>)}
          </div>
        </section>
        <section onClick={() => setMode("personal")} style={{ marginTop: 24, border: `2px solid ${mode === "personal" ? "#5B78F6" : RISE.grayLine}`, borderRadius: 20, padding: "32px 20px 22px", boxShadow: mode === "personal" ? "0 8px 24px rgba(91,120,246,.12)" : "none", cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 14, fontSize: 19, fontWeight: 800 }}><span style={{ width: 24, height: 24, flexShrink: 0, border: "2px solid #BFC0C5", borderRadius: "50%", display: "grid", placeItems: "center" }}>{mode === "personal" && <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#5B78F6" }} />}</span><span>צפי שלי</span></div>
          <div style={{ display: "flex", direction: "ltr", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 18 }}><span style={{ color: "#5B78F6", fontSize: 24, fontWeight: 800 }}>₪</span>
            <input
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(e) => { setMode("personal"); setValue(e.target.value); }}
              onWheel={(e) => e.currentTarget.blur()}
              onKeyDown={(e) => e.key === "Enter" && valid && !saving && onSave(parsed)}
              dir="ltr"
              style={{ flex: "0 0 238px", minWidth: 0, height: 64, padding: "0 14px", borderRadius: 16, border: `2px solid ${RISE.grayLine}`, fontSize: 42, fontWeight: 800, color: RISE.ink, outline: "none", textAlign: "right", fontFamily: "inherit", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ marginTop: 16, textAlign: "right", fontSize: 18, fontWeight: 700 }}>נשאר להוציא <Money value={Math.max(0, parsed - spent)} /></div>
          <label onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 26, fontSize: 16 }}><input type="checkbox" checked={onlyThisMonth} onChange={(e) => setOnlyThisMonth(e.target.checked)} style={{ width: 24, height: 24, accentColor: "#5B78F6" }} />שמור את הצפי הזה רק ל{monthLabel.split(" ")[0]}</label>
        </section>
        <button onClick={() => valid && onSave(parsed)} disabled={!valid || saving} style={{ width: "100%", marginTop: 28, height: 58, border: 0, borderRadius: 20, background: "#5B78F6", color: "#fff", fontSize: 22, fontWeight: 800, fontFamily: "inherit" }}>{saving ? "שומר…" : "עדכון"}</button>
      </div>
    </div>
  );
}
