import { useMemo, useState } from "react";
import { RISE } from "@/riseup/compute";
import { Money } from "@/riseup/components";

export type ReviewRow = { name: string; suggested: number; average: number };

export default function StartOfMonthReview({
  month, rows, saving, onClose, onConfirm,
}: {
  month: string;
  rows: ReviewRow[];
  saving: boolean;
  onClose: () => void;
  onConfirm: (values: Record<string, number>) => void;
}) {
  const suggestedTotal = rows.reduce((sum, row) => sum + Math.max(0, row.suggested), 0);
  const [mode, setMode] = useState<"automatic" | "personal">("personal");
  const [value, setValue] = useState(String(Math.round(suggestedTotal)));
  const [personalOnly, setPersonalOnly] = useState(false);
  const numericValue = Math.max(0, Number(value.replace(/,/g, "")) || 0);
  const maxBar = Math.max(1, ...rows.map((row) => row.average || row.suggested));
  const chartRows = rows.slice(-5).reverse();

  const monthLabel = useMemo(() => {
    const [year, monthNumber] = month.split("-");
    return `${["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"][Number(monthNumber) - 1]} ${year}`;
  }, [month]);

  const confirm = () => {
    const ratio = suggestedTotal > 0 ? numericValue / suggestedTotal : 0;
    onConfirm(Object.fromEntries(rows.map((row) => [row.name, Math.max(0, row.suggested * ratio)])));
  };

  const radio = (selected: boolean) => (
    <span aria-hidden="true" style={{ width: 32, height: 32, border: "2px solid #BFC0C5", borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0 }}>
      {selected && <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#5B78F6" }} />}
    </span>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(28, 35, 46, .78)", display: "flex", justifyContent: "center", alignItems: "flex-end" }}>
      <div onClick={(event) => event.stopPropagation()} dir="rtl" style={{ position: "relative", width: "100%", maxWidth: 480, maxHeight: "calc(100vh - 58px)", overflowY: "auto", background: "#fff", borderRadius: "28px 28px 0 0", padding: "30px 56px 34px", boxSizing: "border-box", fontFamily: "Heebo, sans-serif", color: RISE.ink }}>
        <button type="button" onClick={onClose} aria-label="סגירה" style={{ position: "absolute", top: 26, left: 28, border: 0, background: "none", color: "#505158", fontSize: 48, lineHeight: 1, fontWeight: 300, cursor: "pointer" }}>×</button>
        <h2 style={{ margin: "22px 0 56px", fontSize: 32, lineHeight: 1.15, fontWeight: 800, textAlign: "right" }}>כמה כסף צפוי לצאת על {rows[0]?.name || "הקטגוריה"} ב{monthLabel.split(" ")[0]}?</h2>

        <section style={{ border: `2px solid ${RISE.grayLine}`, borderRadius: 26, padding: "38px 28px 30px", opacity: .55, minHeight: 420, boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 22, fontWeight: 800, color: "#C8C8CC" }}>
            <span>צפי אוטומטי לפי העבר</span>{radio(false)}
          </div>
          <div style={{ marginTop: 16, textAlign: "center", fontSize: 58, fontWeight: 800, color: "#D6D6D9" }}><Money value={suggestedTotal} /></div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, height: 260, borderBottom: `2px solid ${RISE.grayLine}`, marginTop: 24 }}>
            {chartRows.map((row) => {
              const amount = row.average || row.suggested;
              return <div key={row.name} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 16, color: RISE.ink }}>{Math.round(amount)}</span>
                <div style={{ width: "100%", maxWidth: 42, height: `${Math.max(24, (amount / maxBar) * 185)}px`, borderRadius: "22px 22px 0 0", background: "#D8E5F6" }} />
                <span style={{ color: "#C8C8CC", fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%", textAlign: "center" }}>{row.name}</span>
              </div>;
            })}
          </div>
        </section>

        <section onClick={() => setMode("personal")} style={{ marginTop: 46, border: `2px solid ${mode === "personal" ? "#5B78F6" : RISE.grayLine}`, borderRadius: 26, padding: "28px 28px 30px", boxShadow: mode === "personal" ? "0 8px 24px rgba(91,120,246,.12)" : "none", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 22, fontWeight: 800 }}><span>צפי שלי</span>{radio(mode === "personal")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 26 }}>
            <span style={{ color: "#5B78F6", fontSize: 30, fontWeight: 800 }}>₪</span>
            <input aria-label="סכום צפוי" value={value} onChange={(event) => { setMode("personal"); setValue(event.target.value); }} onClick={(event) => event.stopPropagation()} inputMode="decimal" dir="ltr" style={{ flex: 1, minWidth: 0, height: 92, border: `2px solid ${RISE.grayLine}`, borderRadius: 18, padding: "0 20px", fontSize: 62, fontWeight: 800, color: RISE.ink, textAlign: "right", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
          </div>
          <div style={{ marginTop: 22, textAlign: "right", fontSize: 22, fontWeight: 700 }}>נשאר להוציא <Money value={numericValue} /></div>
          <label onClick={(event) => event.stopPropagation()} style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 14, marginTop: 44, fontSize: 18, cursor: "pointer" }}>
            <input type="checkbox" checked={personalOnly} onChange={(event) => setPersonalOnly(event.target.checked)} style={{ width: 30, height: 30, accentColor: "#5B78F6" }} />
            <span>שמור את הצפי הזה רק לי</span>
          </label>
        </section>

        <button type="button" onClick={confirm} disabled={saving} style={{ width: "100%", marginTop: 48, height: 78, border: 0, borderRadius: 24, background: "#5B78F6", color: "#fff", fontFamily: "inherit", fontSize: 28, fontWeight: 800, cursor: saving ? "wait" : "pointer", opacity: saving ? .65 : 1 }}>{saving ? "שומר…" : "עדכון"}</button>
      </div>
    </div>
  );
}
