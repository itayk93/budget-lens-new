import { useState, useEffect, useRef, ReactNode, createContext, useContext } from "react";
import { RISE, Txn, CategoryGroup, WeekBudget, TransactionSplitInput, flowDate, weeklyBreakdown, isSplitTxn, splitOriginalAmount } from "./compute";

// Context so any TxnRow deep in the tree can open the edit sheet.
export const TxnEditContext = createContext<(t: Txn) => void>(() => {});

/* ----- money: amount is isolated in LTR so ₪ stays visually on the left ----- */
export function Money({ value, className, style }: { value: number; className?: string; style?: React.CSSProperties }) {
  const v = Math.abs(value);
  const [intStrRaw, decStr] = v.toFixed(1).split(".");
  const intStr = Number(intStrRaw).toLocaleString("en-US");

  return (
    <span dir="ltr" className={className} style={{ whiteSpace: "nowrap", unicodeBidi: "isolate", fontVariantNumeric: "tabular-nums", ...style }}>
      <span style={{ marginInlineEnd: 3 }}>₪</span>
      {intStr}
      <span style={{ fontSize: "0.7em", verticalAlign: "baseline" }}>.{decStr}</span>
    </span>
  );
}

/* ----- progress bar: fills from the RIGHT (inline-start in RTL) ----- */
export function Bar({ pct, track, fill }: { pct: number; track: string; fill: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ background: track, borderRadius: 99, height: 14, width: "100%", overflow: "hidden", display: "flex" }}>
      {/* flex in RTL packs children from the right, so the fill sits on the right */}
      <div style={{ background: fill, height: "100%", width: `${p}%`, borderRadius: 99, transition: "width 1s ease" }} />
    </div>
  );
}

function SmoothExpand({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 0.4s ease" }}>
      <div style={{ overflow: "hidden" }}>{children}</div>
    </div>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card-wrapper" style={{ background: "#fff", borderRadius: 18, margin: "0 0 24px", overflow: "hidden", boxShadow: "0 4px 12px rgba(186, 188, 191, .25)", border: "none", ...style }}>
      {children}
    </div>
  );
}

export function SummaryAmountCard({ name, amount, title = "כמה כסף נשאר להוציא על הוצאות משתנות השבוע?" }: { name: string; amount: number; title?: string }) {
  return (
    <Card style={{ padding: "20px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div style={{ alignSelf: "stretch", color: RISE.ink, fontSize: 16, lineHeight: 1, fontWeight: 400, marginBottom: 12 }}>היי {name}</div>
        <div style={{ color: RISE.ink, fontSize: 20, fontWeight: 700, lineHeight: "26px", marginBottom: 6 }}>{title}</div>
        {/* the real app shows this headline rounded to whole shekels */}
        <div dir="ltr" style={{ color: RISE.green, fontSize: 54, lineHeight: 1.15, fontWeight: 500, marginTop: 10, letterSpacing: -1.5, unicodeBidi: "isolate", whiteSpace: "nowrap" }}>
          <span style={{ marginInlineEnd: 7 }}>₪</span>
          {Math.round(amount).toLocaleString("en-US")}
        </div>
        <button style={{ marginTop: 18, padding: "7px 14px", borderRadius: 99, border: `1px solid ${RISE.grayLine}`, background: "#fff", color: RISE.ink, fontSize: 14, lineHeight: "18px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontFamily: "inherit" }}>
          ומה מצב העו״ש?
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </div>
    </Card>
  );
}

export function RiseupGoalCard({ amount }: { amount: number }) {
  return (
    <Card style={{ padding: "20px 22px" }}>
      <div style={{ color: RISE.ink, fontSize: 16, fontWeight: 700, marginBottom: 4 }}>היעד החודשי</div>
      <div style={{ color: RISE.ink, fontSize: 14, marginBottom: 16 }}>כמה אני רוצה להשאיר בצד בסוף החודש?</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ color: RISE.ink, fontSize: 24, fontWeight: 700, marginBottom: 8 }}><Money value={amount} style={{ letterSpacing: -1 }} /></div>
          <button style={{ padding: "8px 16px", borderRadius: 99, border: "none", background: RISE.blue, color: "#fff", fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            בחירת יעד
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        </div>
        <div style={{ width: 80, height: 80, background: "#f0f0f0", borderRadius: 40 }} /> {/* Placeholder for coins image */}
      </div>
    </Card>
  );
}

export function Kebab() {
  return (
    <button aria-label="אפשרויות" style={{ display: "flex", flexDirection: "column", gap: 3, padding: 8, cursor: "pointer", background: "none", border: "none", flexShrink: 0 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 4, height: 4, borderRadius: 99, background: RISE.ink }} />
      ))}
    </button>
  );
}

/* category kebab; its menu contains the "עריכת סכום" action */
export function EditKebab({ onClick }: { onClick: () => void }) {
  return (
    <button
      aria-label="תפריט"
      title="תפריט"
      onClick={onClick}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: 8, cursor: "pointer", background: "none", border: "none", flexShrink: 0, borderRadius: 8 }}
    >
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 4, height: 4, borderRadius: 99, background: RISE.ink }} />
      ))}
    </button>
  );
}

/* card header: title on the RIGHT, kebab on the LEFT */
export function CardHeader({ title }: { title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
      <h2 style={{ fontSize: 24, fontWeight: 700, color: RISE.ink, margin: 0, textAlign: "start", fontFamily: "Heebo, sans-serif" }}>{title}</h2>
      <Kebab />
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ transition: "transform 0.5s ease", transform: open ? "rotate(180deg)" : "none", flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" stroke={RISE.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function fmtDate(t: Txn) {
  // The flow month controls grouping only. Always show the transaction's
  // original payment/charge date, even after moving it between flow months.
  const d = t.payment_date || t.charge_date || "";
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${Number(day)}.${Number(m)}.${y.slice(2)}`;
}

function businessSortName(t: Txn) {
  return (t.business_name || "").trim();
}

function startsWithEnglish(value: string) {
  return /^[A-Za-z]/.test(value);
}

function compareTxnInWeek(a: Txn, b: Txn) {
  const dateDiff = flowDate(a).localeCompare(flowDate(b));
  if (dateDiff !== 0) return dateDiff;

  const aName = businessSortName(a);
  const bName = businessSortName(b);
  const aEnglish = startsWithEnglish(aName);
  const bEnglish = startsWithEnglish(bName);
  if (aEnglish !== bEnglish) return aEnglish ? -1 : 1;

  return aName.localeCompare(bName, "he", { sensitivity: "base" });
}

function txnDisplayNote(t: Txn): string | null {
  if (!t.notes) return null;
  if (isSplitTxn(t)) {
    const m = t.notes.match(/הערת פיצול: ([^|]+)/);
    return m ? m[1].trim() || null : null;
  }
  const cleaned = t.notes.replace(/\[AUTO:[^\]]*\][^|]*/g, "").trim();
  return cleaned || null;
}

/* transaction row: date RIGHT, amount+business CENTER (right-aligned), kebab LEFT */
export function TxnRow({ t }: { t: Txn }) {
  const pending = t.status && t.status !== "approved";
  const card = t.payment_method && !/^\d{3,4}$/.test(t.payment_method.trim()) ? t.payment_method : "";
  const openEdit = useContext(TxnEditContext);
  const origAmount = splitOriginalAmount(t);
  const displayNote = txnDisplayNote(t);
  return (
    <div className="txn-row" onClick={() => openEdit(t)} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 22px", borderTop: `1px solid ${RISE.grayLine}`, background: RISE.cardGray, cursor: "pointer", transition: "background-color 0.3s ease" }}>
      <div dir="ltr" style={{ color: RISE.ink, fontSize: 14, minWidth: 54, textAlign: "start" }}>{fmtDate(t)}</div>
      <div style={{ flex: 1, textAlign: "start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: RISE.ink }}>
          <Money value={Math.abs(t.amount)} />
          {pending && (
            <span title="טרם נקלט" aria-label="טרם נקלט" style={{ background: RISE.blueSoft, borderRadius: 6, padding: "1px 4px", fontSize: 11, lineHeight: 1 }}>⏳</span>
          )}
          {origAmount != null && (
            <span style={{ background: RISE.grayLine, color: RISE.gray, borderRadius: 8, padding: "3px 8px", fontSize: 12, fontWeight: 600 }}>
              מתוך <Money value={origAmount} />
            </span>
          )}
        </div>
        <div style={{ color: RISE.ink, fontSize: 14, marginTop: 3 }} dir="auto">
          {t.business_name}{card ? ` ${card}` : ""}
        </div>
        {displayNote && (
          <div dir="auto" style={{ display: "inline-block", marginTop: 8, background: RISE.grayLine, color: RISE.ink, borderRadius: 8, padding: "6px 10px", fontSize: 13, fontWeight: 600 }}>
            {displayNote}
          </div>
        )}
      </div>
      <Kebab />
    </div>
  );
}

/* collapsible footer: label RIGHT, chevron LEFT */
export function Collapsible({ label, children, defaultOpen, amount }: { label: string; children: ReactNode; defaultOpen?: boolean; amount?: number }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", background: "#fff", border: "none", borderTop: `1px solid ${RISE.grayLine}`, cursor: "pointer", fontSize: 16, fontWeight: 700, color: RISE.ink, fontFamily: "inherit" }}
      >
        <span style={{ textAlign: "start" }}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {amount !== undefined && <span style={{ fontWeight: 400, fontSize: 14 }}><Money value={amount} /></span>}
          <Chevron open={open} />
        </span>
      </button>
      <SmoothExpand open={open}>
        <div>{children}</div>
      </SmoothExpand>
    </div>
  );
}



export function BudgetCard({
  title, spent, expected, fill, track, amountColor, detailLabel, txns, expectedLabel = "צפוי לצאת",
  weekly, month, group, subGroups, onEdit, defaultOpen, finished = false,
}: {
  title: string; spent: number; expected: number; fill: string; track: string; amountColor: string;
  detailLabel: string; txns: Txn[]; expectedLabel?: string;
  weekly?: boolean; month?: string; group?: CategoryGroup; subGroups?: CategoryGroup[]; onEdit?: () => void; defaultOpen?: boolean; finished?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const effectiveExpected = finished ? spent : expected;
  const budget = Math.max(effectiveExpected, 1);
  const pct = (spent / budget) * 100;
  // Round to agorot before comparing: a target stored as a whole shekel against a spend
  // of 2,221.04 must not read as an overrun.
  const over = !finished && Math.round(spent * 100) > Math.round(effectiveExpected * 100) && effectiveExpected > 0;
  const remaining = effectiveExpected - spent;
  return (
    <Card>
      <div style={{ padding: "22px 22px 20px" }}>
        <div style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 24, color: RISE.ink, textAlign: "start" }}>{title}</div>
          {onEdit && <>
            <EditKebab onClick={() => setMenuOpen((open) => !open)} />
            {menuOpen && (
              <div role="menu" aria-label="תפריט" style={{ position: "absolute", top: 42, left: 0, zIndex: 5, minWidth: 170, padding: 6, border: `1px solid ${RISE.grayLine}`, borderRadius: 12, background: "#fff", boxShadow: "0 8px 24px rgba(24,31,42,.14)" }}>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit(); }} style={{ width: "100%", padding: "11px 12px", border: 0, borderRadius: 8, background: "transparent", color: RISE.ink, textAlign: "right", fontFamily: "inherit", fontSize: 15, cursor: "pointer" }}>
                  עריכת סכום
                </button>
              </div>
            )}
          </>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, color: RISE.ink }}>
          <div style={{ textAlign: "start" }}>
            <div style={{ fontSize: 12, lineHeight: "11px", marginBottom: 5 }}>יצא</div>
            <div style={{ fontSize: 18, lineHeight: "21px", fontWeight: 700, color: amountColor }}><Money value={spent} /></div>
          </div>
          {!finished && (
            <div style={{ textAlign: "end" }}>
              <div style={{ fontSize: 12, lineHeight: "11px", marginBottom: 5 }}>{expectedLabel}</div>
              <div style={{ fontSize: 18, lineHeight: "21px", fontWeight: 400 }}><Money value={effectiveExpected} /></div>
            </div>
          )}
        </div>
        <Bar pct={pct} track={over ? RISE.orangeSoft : track} fill={over ? RISE.orange : fill} />
        {!finished && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 12, fontWeight: 700, lineHeight: "10px", color: RISE.ink, textAlign: "start" }}>
          {over ? (
            <div style={{ color: RISE.orange, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ background: RISE.orange, color: "#fff", borderRadius: 99, width: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}>!</span>
              <span>חריגה של <Money value={Math.abs(remaining)} /></span>
            </div>
          ) : (
            <div>נשאר להוציא <Money value={Math.max(0, remaining)} /></div>
          )}
        </div>}
      </div>
      {weekly && month && group ? (
        <WeeklyBreakdown group={group} recommended={expected} month={month} pillColor={fill} spentColor={amountColor} defaultOpen={defaultOpen} />
      ) : subGroups && subGroups.length > 0 ? (
        <Collapsible label={detailLabel} defaultOpen={defaultOpen}>
          <SubGroupsBreakdown groups={subGroups} amountColor={amountColor} expectedLabel={expectedLabel} finished={finished} />
        </Collapsible>
      ) : txns.length > 0 ? (
        <Collapsible label={detailLabel} defaultOpen={defaultOpen}>
          {txns.slice().sort((a, b) => flowDate(a).localeCompare(flowDate(b))).map((t) => <TxnRow key={t.id} t={t} />)}
        </Collapsible>
      ) : null}
    </Card>
  );
}

export function SubGroupsBreakdown({ groups, amountColor, expectedLabel = "צפוי לצאת", finished = false }: { groups: CategoryGroup[]; amountColor: string; expectedLabel?: string; finished?: boolean }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", padding: "14px 22px", color: RISE.ink, fontWeight: 700, fontSize: 14, borderTop: `1px solid ${RISE.grayLine}` }}>
        <span style={{ flex: 1, textAlign: "start" }} />
        <span style={{ flex: 1, textAlign: "center" }}>יצא</span>
        {!finished && <span style={{ flex: 1, textAlign: "center" }}>{expectedLabel}</span>}
        <span style={{ width: 22 }} />
      </div>
      {groups.map((g) => (
        <SubGroupRow key={g.name} group={g} amountColor={amountColor} finished={finished} />
      ))}
    </div>
  );
}

function SubGroupRow({ group, amountColor, finished = false }: { group: CategoryGroup; amountColor: string; finished?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasTxns = group.txns.length > 0;

  return (
    <div>
      <button
        onClick={() => hasTxns && setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!hasTxns}
        style={{ width: "100%", display: "flex", alignItems: "center", padding: "16px 22px", background: "#fff", border: "none", borderTop: `1px solid ${RISE.grayLine}`, cursor: hasTxns ? "pointer" : "default", fontFamily: "inherit" }}
      >
        <span style={{ flex: 1, textAlign: "start", color: RISE.ink, fontSize: 14, fontWeight: 700 }}>{group.name}</span>
        <span style={{ flex: 1, textAlign: "center", color: amountColor, fontWeight: 700, fontSize: 14 }}>
          <Money value={group.spent} />
        </span>
        {!finished && (
          <span style={{ flex: 1, textAlign: "center", color: RISE.ink, fontSize: 14 }}>
            <Money value={group.expected} />
          </span>
        )}
        {hasTxns ? (
          <Chevron open={open} />
        ) : (
          <span style={{ width: 22 }} />
        )}
      </button>
      {hasTxns && (
        <SmoothExpand open={open}>
          <div>
            {group.txns.slice().sort((a, b) => flowDate(a).localeCompare(flowDate(b))).map((t) => (
              <TxnRow key={t.id} t={t} />
            ))}
          </div>
        </SmoothExpand>
      )}
    </div>
  );
}

/* weekly breakdown — Hebrew calendar weeks (Sun–Sat), like Riseup's weekly super-categories.
   The leftover budget is re-spread by days from the current week onwards; see weeklyBreakdown. */
export function WeeklyBreakdown({ group, recommended, month, pillColor = RISE.yellow, spentColor = RISE.yellowText, defaultOpen }: { group: CategoryGroup; recommended: number; month: string; pillColor?: string; spentColor?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const weeks = weeklyBreakdown(group.txns, month, recommended);

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", background: "#fff", border: "none", borderTop: `1px solid ${RISE.grayLine}`, cursor: "pointer", fontSize: 16, fontWeight: 700, color: RISE.ink, fontFamily: "inherit" }}>
        <span style={{ textAlign: "start" }}>פירוט שבועי</span>
        <Chevron open={open} />
      </button>
      <SmoothExpand open={open}>
        <div>
          <div style={{ display: "flex", alignItems: "center", padding: "14px 22px", color: RISE.ink, fontWeight: 700, fontSize: 14, borderTop: `1px solid ${RISE.grayLine}` }}>
            <span style={{ width: 96 }} />
            <span style={{ flex: 1, textAlign: "center" }}>יצא</span>
            <span style={{ flex: 1, textAlign: "center" }}>נשאר להוציא</span>
            <span style={{ width: 22 }} />
          </div>
          {weeks.map((w) => (
            <WeekRow key={w.week} w={w} pillColor={pillColor} spentColor={spentColor} />
          ))}
        </div>
      </SmoothExpand>
    </div>
  );
}

function WeekRow({ w, pillColor, spentColor }: { w: WeekBudget; pillColor: string; spentColor: string }) {
  const { week, txns, isCurrent, isFuture, spent, remaining } = w;
  const [open, setOpen] = useState(false);
  // Weeks that haven't started yet are dimmed and can't be opened, like in the real app.
  const muted = isFuture;
  return (
    <div>
      <button onClick={() => !muted && setOpen((o) => !o)} aria-expanded={open} disabled={muted} style={{ width: "100%", display: "flex", alignItems: "center", padding: "16px 22px", background: "#fff", border: "none", borderTop: `1px solid ${RISE.grayLine}`, cursor: muted ? "default" : "pointer", fontFamily: "inherit" }}>
        <span style={{ width: 96, textAlign: "start" }}>
          {isCurrent ? (
            <span style={{ background: pillColor, color: RISE.ink, borderRadius: 99, padding: "5px 12px", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}>{`שבוע ${week}`}</span>
          ) : (
            <span style={{ color: muted ? RISE.gray : RISE.ink, fontSize: 14 }}>{`שבוע ${week}`}</span>
          )}
        </span>
        <span style={{ flex: 1, textAlign: "center", color: muted ? RISE.gray : spentColor, fontWeight: 700, fontSize: 14 }}><Money value={spent} /></span>
        <span style={{ flex: 1, textAlign: "center", color: muted ? RISE.gray : RISE.ink, fontSize: 14 }}><Money value={remaining} /></span>
        {muted ? <span style={{ width: 22 }} /> : <Chevron open={open} />}
      </button>
      <SmoothExpand open={open && !muted}>
        <div>
          {txns.slice().sort(compareTxnInWeek).map((t) => <TxnRow key={t.id} t={t} />)}
        </div>
      </SmoothExpand>
    </div>
  );
}

/* ---- transaction action sheet — Riseup style (colored header + action rows) ---- */
function txnSourceLabel(t: Txn): string | null {
  if (t.source_type === "manual") return "הוזן ידנית באפליקציה";
  if (t.file_source === "legacy") return "יובא מריסאפ (Riseup)";
  if (t.file_source === "bank_scraper" || t.source_type === "bank_scraper") return "נסרק אוטומטית מהבנק";
  if (t.source_type === "creditCard") return "כרטיס אשראי (נסרק מהבנק)";
  if (t.source_type === "checkingAccount" || t.source_type === "BankAccount") return "חשבון עו\"ש (נסרק מהבנק)";
  if (t.source_type === "investment") return "השקעות";
  return null;
}

function txnHeaderColor(name) {
  const n = name || "";
  if (n.startsWith("הכנס")) return { bg: RISE.green, soft: RISE.greenSoft };
  if (n.includes("חסכון") || n.includes("חיסכון")) return { bg: RISE.orange, soft: RISE.orangeSoft };
  if (["דיור","חשמל","מים","ארנונה","תקשורת","ביטוח","גז","כושר","דיגיטל","כללי","שכר דירה","עמלות","תשלומים"].some(k=>n.includes(k))) return { bg: RISE.pink, soft: RISE.pinkSoft };
  return { bg: RISE.yellow, soft: RISE.yellowSoft };
}

function ActionRow({ icon, label, onClick, danger = false }) {
  return (
    <button onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", background: "#fff", border: `1px solid ${danger ? "#FECACA" : RISE.grayLine}`, borderRadius: 14, cursor: "pointer", fontFamily: "inherit", marginBottom: 12 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: danger ? "#B91C1C" : RISE.ink, textAlign: "start" }}>{label}</span>
      <span aria-hidden style={{ color: danger ? "#B91C1C" : RISE.ink, display: "flex" }}>{icon}</span>
    </button>
  );
}

const ic = (d) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={RISE.ink} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;

export function TxnEditSheet({ txn, categories, onClose, onSave, saving, onSplit, onUnsplit, onDelete }: { txn: Txn; categories: string[]; onClose: () => void; onSave: (patch: Partial<Txn>) => void; saving: boolean; onSplit?: (splits: TransactionSplitInput[]) => void; onUnsplit?: () => void; onDelete?: () => void }) {
  const [mode, setMode] = useState("menu"); // menu | category | note | month
  const [notes, setNotes] = useState(txn.notes || "");
  const [q, setQ] = useState("");
  const [splitSaving, setSplitSaving] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);
  const isSplit = isSplitTxn(txn);
  const sourceLabel = txnSourceLabel(txn);

  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const d = txn.payment_date || txn.charge_date || "";
  const dateStr = d ? `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.${d.slice(2, 4)}` : "";
  const col = txnHeaderColor(txn.category_name);
  const card = txn.payment_method && !/^\d{3,4}$/.test((txn.payment_method||"").trim()) ? txn.payment_method : (txn.payment_method ? `כרטיס ${txn.payment_method}` : "");
  const filtered = categories.filter((c) => !q || c.includes(q));
  const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const currentFlowMonth = txn.flow_month || txn.payment_date?.slice(0, 7) || "";
  const shiftMonth = (delta: number) => {
    const [year, month] = currentFlowMonth.split("-").map(Number);
    const date = new Date(year, (month || 1) - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  };
  const monthText = (value: string) => {
    const [year, month] = value.split("-").map(Number);
    return `${monthNames[(month || 1) - 1]} ${year}`;
  };

  const sheet = (children, pad = true) => (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onScroll={(e) => {
          const el = e.currentTarget;
          const maxScroll = el.scrollHeight - el.clientHeight;
          setScrollProgress(maxScroll > 0 ? Math.min(1, el.scrollTop / maxScroll) : 1);
        }}
        dir="rtl"
        className="app-frame riseup-bottom-sheet"
        style={{ position: "relative", background: "#fff", width: "100%", maxWidth: 480, borderStartStartRadius: 22, borderStartEndRadius: 22, maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", fontFamily: "Heebo, sans-serif", paddingBottom: pad ? 20 : 0 }}
      >
        <div
          onTouchStart={(e) => { touchStartY.current = e.touches[0]?.clientY ?? null; }}
          onTouchEnd={(e) => {
            const startY = touchStartY.current;
            touchStartY.current = null;
            if (startY !== null && (e.changedTouches[0]?.clientY ?? startY) - startY > 80) onClose();
          }}
          aria-label="משיכה לסגירה"
          style={{ width: 44, height: 5, borderRadius: 99, background: "rgba(0,0,0,.22)", position: "absolute", top: 10, insetInlineStart: 0, insetInlineEnd: 0, margin: "0 auto", zIndex: 2, touchAction: "none", cursor: "grab" }}
        />
        <div className="riseup-scroll-progress" aria-hidden="true">
          <div style={{ transform: `scaleX(${scrollProgress})` }} />
        </div>
        {children}
      </div>
    </div>
  );

  if (mode === "category") {
    return sheet(
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 12px" }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: RISE.ink, textAlign: "start" }}>לאיזו קטגוריה להזיז?</h3>
          <button aria-label="חזרה" onClick={() => setMode("menu")} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>{ic(<path d="M15 6l-6 6 6 6" />)}</button>
        </div>
        <div style={{ padding: "0 20px 12px" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} dir="auto" placeholder="חיפוש קטגוריה" style={{ width: "100%", border: `1px solid ${RISE.grayLine}`, borderRadius: 99, padding: "12px 16px", fontFamily: "inherit", fontSize: 15, color: RISE.ink }} />
        </div>
        <div>
          {filtered.map((c) => (
            <button key={c} onClick={() => onSave({ category_name: c })} disabled={saving} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 22px", background: c === txn.category_name ? RISE.blueSoft : "#fff", border: "none", borderTop: `1px solid ${RISE.grayLine}`, cursor: "pointer", fontFamily: "inherit", fontSize: 16, color: RISE.ink, fontWeight: c === txn.category_name ? 700 : 400, textAlign: "start" }}>
              <span>{c}</span>
              {c === txn.category_name && <span style={{ color: RISE.blue }}>{ic(<path d="M20 6L9 17l-5-5" />)}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (mode === "month") {
    const previous = shiftMonth(-1);
    const next = shiftMonth(1);
    return sheet(
      <div style={{ padding: "8px 20px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0 16px" }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: RISE.ink }}>להזיז לחודש אחר</h3>
          <button aria-label="חזרה" onClick={() => setMode("menu")} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>{ic(<path d="M15 6l-6 6 6 6" />)}</button>
        </div>
        <div style={{ color: RISE.gray, fontSize: 14, marginBottom: 14, textAlign: "start" }}>העסקה נמצאת כרגע בתזרים של {monthText(currentFlowMonth)}.</div>
        <ActionRow icon={ic(<path d="M19 12H5M12 19l-7-7 7-7" />)} label={`לחודש הקודם · ${monthText(previous)}`} onClick={() => onSave({ flow_month: previous })} />
        <ActionRow icon={ic(<path d="M5 12h14M12 5l7 7-7 7" />)} label={`לחודש הבא · ${monthText(next)}`} onClick={() => onSave({ flow_month: next })} />
        <button onClick={() => setMode("menu")} style={{ width: "100%", padding: "13px", borderRadius: 99, border: `1px solid ${RISE.grayLine}`, background: "#fff", color: RISE.ink, fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
      </div>
    );
  }

  if (mode === "note") {
    return sheet(
      <div style={{ padding: "8px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0 16px" }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: RISE.ink }}>הערה</h3>
          <button aria-label="חזרה" onClick={() => setMode("menu")} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>{ic(<path d="M15 6l-6 6 6 6" />)}</button>
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" rows={3} autoFocus placeholder="הוספת הערה…" style={{ width: "100%", border: `1px solid ${RISE.grayLine}`, borderRadius: 14, padding: "12px 14px", fontFamily: "inherit", fontSize: 15, resize: "none", color: RISE.ink }} />
        <button onClick={() => onSave({ notes })} disabled={saving} style={{ width: "100%", marginTop: 14, padding: "14px", borderRadius: 99, border: "none", background: RISE.blue, color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: "inherit", opacity: saving ? 0.6 : 1 }}>{saving ? "שומר…" : "שמירה"}</button>
      </div>
    );
  }

  if (mode === "delete") {
    return sheet(
      <div style={{ padding: "8px 20px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0 16px" }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: RISE.ink }}>מחיקת רשומה</h3>
          <button aria-label="חזרה" onClick={() => setMode("menu")} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>{ic(<path d="M15 6l-6 6 6 6" />)}</button>
        </div>
        <div style={{ fontSize: 15, color: RISE.ink, marginBottom: 20, textAlign: "start" }}>
          האם אתה בטוח שברצונך למחוק את הרשומה "{txn.business_name}"? פעולה זו אינה הפיכה.
        </div>
        <button onClick={onDelete} disabled={saving} style={{ width: "100%", padding: "14px", borderRadius: 99, border: "none", background: "#DC2626", color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: "inherit", opacity: saving ? 0.6 : 1 }}>{saving ? "מוחק…" : "כן, למחוק"}</button>
        <button onClick={() => setMode("menu")} disabled={saving} style={{ width: "100%", marginTop: 10, padding: "14px", borderRadius: 99, border: `1px solid ${RISE.grayLine}`, background: "#fff", color: RISE.ink, fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
      </div>
    );
  }

  if (mode === "split" && onSplit) {
    return <TxnSplitSheet txn={txn} categories={categories} onClose={() => setMode("menu")} onSave={async (splits) => {
      setSplitSaving(true);
      try {
        await onSplit(splits);
        onClose();
      } finally {
        setSplitSaving(false);
      }
    }} saving={splitSaving || saving} />;
  }

  // menu
  return sheet(
    <div>
      {/* colored header */}
      <div style={{ background: col.bg, padding: "26px 22px 22px", borderStartStartRadius: 22, borderStartEndRadius: 22, textAlign: "start" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: RISE.ink }}>{txn.category_name || "ללא קטגוריה"}</div>
          {isSplit && (
            <span style={{ fontSize: 12, fontWeight: 700, background: "rgba(0,0,0,0.12)", color: RISE.ink, padding: "2px 8px", borderRadius: 6 }}>
              עסקה מפוצלת
            </span>
          )}
        </div>
        <div style={{ margin: "6px 0 8px" }}><Money value={Math.abs(txn.amount)} style={{ fontSize: 40, fontWeight: 800, color: RISE.ink }} /></div>
        <div style={{ fontSize: 15, color: RISE.ink }} dir="auto">{txn.business_name}{card ? ` ${card}` : ""}</div>
        <div style={{ fontSize: 14, color: RISE.ink, opacity: .8, marginTop: 2 }}>{dateStr}</div>
        {sourceLabel && (
          <div style={{ fontSize: 12, color: RISE.ink, opacity: .65, marginTop: 4 }}>מקור: {sourceLabel}</div>
        )}
      </div>
      {/* action rows */}
      <div style={{ padding: "16px 16px 0" }}>
        <ActionRow icon={ic(<><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></>)} label="להוסיף הערה" onClick={() => setMode("note")} />
        <ActionRow icon={ic(<><path d="M3 7h13M3 7l3-3M3 7l3 3M21 17H8M21 17l-3-3M21 17l-3 3" /></>)} label="להזיז את ההוצאה" onClick={() => setMode("category")} />
        {!isSplit && (
          <ActionRow icon={ic(<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" /></>)} label="לפצל את ההוצאה" onClick={() => onSplit ? setMode("split") : alert("פיצול עסקה — בקרוב")} />
        )}
        <ActionRow icon={ic(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>)} label="להזיז את העסקה לחודש אחר" onClick={() => setMode("month")} />
        <ActionRow icon={ic(<><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>)} label="זו הפקדה לחיסכון!" onClick={() => onSave({ category_name: "חסכון חד פעמי" })} />
        <ActionRow icon={ic(<><path d="M18 6L6 18M6 6l12 12" /></>)} label={txn.excluded_from_flow ? "החזרה לתזרים" : "הוצאה מהתזרים"} onClick={() => onSave({ excluded_from_flow: !txn.excluded_from_flow })} />
        {isSplit ? (
          <ActionRow icon={ic(<><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>)} label="ביטול הפיצול (החזרת העסקה המקורית)" danger={true} onClick={onUnsplit} />
        ) : (
          <ActionRow icon={ic(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></>)} label="מחק את הרשומה" danger={true} onClick={() => setMode("delete")} />
        )}
      </div>
    </div>
  );
}

/* =================================================================================
   SPLIT TRANSACTION SHEET (1:1 with Riseup UI)
   ================================================================================= */
type SplitDraft = {
  id: string;
  amount: string;
  category_name: string;
  notes: string;
};

function parseSplitAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function TxnSplitSheet({ txn, categories, onClose, onSave, saving }: { txn: Txn; categories: string[]; onClose: () => void; onSave: (splits: TransactionSplitInput[]) => void; saving: boolean }) {
  const initialCategory = txn.category_name || "הוצאות משתנות";
  const [splits, setSplits] = useState<SplitDraft[]>([
    { id: "split-1", amount: "", category_name: initialCategory, notes: "" },
  ]);
  const [remainderCategory, setRemainderCategory] = useState(initialCategory);
  const [remainderNotes, setRemainderNotes] = useState("");

  const totalAmount = Math.abs(txn.amount);
  const manualTotal = splits.reduce((sum, split) => sum + parseSplitAmount(split.amount), 0);
  const remaining = Number((totalAmount - manualTotal).toFixed(2));
  const remainingClamped = Math.max(0, remaining);
  const isOverTotal = remaining < 0;
  const canAddSplit = !isOverTotal && remainingClamped > 0.009 && splits.every((split) => parseSplitAmount(split.amount) > 0 && split.category_name);
  const isValid = !isOverTotal && splits.every((split) => parseSplitAmount(split.amount) > 0 && split.category_name) && (remainingClamped < 0.009 || !!remainderCategory);

  const updateSplit = (id: string, field: keyof SplitDraft, value: string) => {
    setSplits((current) => current.map((split) => (split.id === id ? { ...split, [field]: value } : split)));
  };

  const removeSplit = (id: string) => {
    setSplits((current) => current.filter((split) => split.id !== id));
  };

  const addSplit = () => {
    if (!canAddSplit) return;
    setSplits((current) => [
      ...current,
      { id: `split-${Date.now()}-${current.length + 1}`, amount: "", category_name: initialCategory, notes: "" },
    ]);
  };

  const saveSplit = () => {
    const sign = txn.amount < 0 ? -1 : 1;
    const payload: TransactionSplitInput[] = splits.map((split) => ({
      amount: Number(parseSplitAmount(split.amount).toFixed(2)) * sign,
      category_name: split.category_name,
      notes: split.notes.trim() || null,
    }));
    if (remainingClamped > 0.009) {
      payload.push({
        amount: Number(remainingClamped.toFixed(2)) * sign,
        category_name: remainderCategory,
        notes: remainderNotes.trim() || null,
      });
    }
    onSave(payload);
  };

  const formattedDate = txn.payment_date 
    ? new Date(txn.payment_date).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" }).replace(/\./g, ".")
    : "";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 9999 }}>
      <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{ position: "relative", background: "#fff", width: "100%", maxWidth: 480, borderStartStartRadius: 24, borderStartEndRadius: 24, maxHeight: "92vh", display: "flex", flexDirection: "column", fontFamily: "Heebo, sans-serif", overflow: "hidden", boxShadow: "0 -10px 40px rgba(0,0,0,0.2)" }}>
        
        {/* Header section with blue gradient background */}
        <div style={{ background: "linear-gradient(180deg, #2563EB 0%, #1D4ED8 100%)", color: "#fff", padding: "24px 20px 28px", position: "relative", textAlign: "center" }}>
          {/* Drag pill handle */}
          <div style={{ width: 40, height: 4, borderRadius: 99, background: "rgba(255,255,255,.4)", position: "absolute", top: 10, insetInlineStart: 0, insetInlineEnd: 0, margin: "0 auto", zIndex: 2 }} />
          
          {/* Close button (top left in RTL) */}
          <button 
            onClick={onClose} 
            aria-label="סגירה"
            style={{ position: "absolute", top: 14, insetInlineEnd: 16, width: 36, height: 36, borderRadius: 999, background: "rgba(255,255,255,0.18)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.2s" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>

          <div style={{ display: "inline-block", background: "rgba(255,255,255,0.2)", padding: "3px 14px", borderRadius: 99, fontSize: 13, fontWeight: 600, marginTop: 8, marginBottom: 8 }}>
            {txn.category_name || "ללא קטגוריה"}
          </div>

          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.1, marginBottom: 8, letterSpacing: "-1px" }}>
            <Money value={Math.abs(txn.amount)} style={{ color: "#fff" }} />
          </div>

          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{txn.business_name}</div>
          <div style={{ fontSize: 13, opacity: 0.85, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
            {txn.payment_method && <span>כרטיס {txn.payment_method.slice(-4)}</span>}
            {formattedDate && <span>{formattedDate}</span>}
          </div>
        </div>

        {/* White body section */}
        <div
          style={{ flex: 1, background: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: -14, padding: "20px 20px 12px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}
        >
          
          <div style={{ fontSize: 20, fontWeight: 800, color: RISE.ink, textAlign: "start" }}>
            איך לפצל את ההוצאה?
          </div>

          {/* Split drafts list */}
          {splits.map((split, idx) => (
            <div key={split.id} style={{ background: "#F9FAFB", border: `1px solid ${RISE.grayLine}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: RISE.ink, textAlign: "start" }}>הוצאה {idx + 1}</div>
                {splits.length > 1 && (
                  <button type="button" onClick={() => removeSplit(split.id)} style={{ background: "none", border: "none", color: "#EF4444", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "2px 6px", borderRadius: 6 }}>
                    הסרה
                  </button>
                )}
              </div>

              {/* Amount input with RTL Shekel symbol */}
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", insetInlineStart: 14, top: "50%", transform: "translateY(-50%)", color: RISE.gray, fontSize: 18, fontWeight: 700, pointerEvents: "none" }}>₪</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={split.amount}
                  onChange={(e) => updateSplit(split.id, "amount", e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder="סכום ההוצאה"
                  style={{
                    width: "100%",
                    paddingBlock: 14,
                    paddingInlineStart: 42, // Padding on right side where ₪ is
                    paddingInlineEnd: 14,   // Padding on left side
                    borderRadius: 12,
                    border: `1px solid ${RISE.grayLine}`,
                    fontSize: 16,
                    color: RISE.ink,
                    outline: "none",
                    textAlign: "start",
                    boxSizing: "border-box",
                    background: "#fff"
                  }}
                />
              </div>

              {/* Category dropdown with RTL left arrow positioning */}
              <div style={{ textAlign: "start" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: RISE.gray, marginBottom: 4 }}>קטגוריה</div>
                <div style={{ position: "relative" }}>
                  <select
                    value={split.category_name}
                    onChange={(e) => updateSplit(split.id, "category_name", e.target.value)}
                    style={{
                      width: "100%",
                      paddingBlock: 14,
                      paddingInlineStart: 14, // Text starts on right
                      paddingInlineEnd: 42,   // Arrow icon space on left
                      borderRadius: 12,
                      border: `1px solid ${RISE.grayLine}`,
                      fontSize: 15,
                      color: RISE.ink,
                      background: "#fff",
                      outline: "none",
                      appearance: "none",
                      boxSizing: "border-box",
                      cursor: "pointer"
                    }}
                  >
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {/* Chevron arrow on the left side in RTL (insetInlineEnd) */}
                  <div style={{ position: "absolute", insetInlineEnd: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: RISE.gray }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </div>
                </div>
              </div>

              {/* Note input */}
              <div style={{ textAlign: "start" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: RISE.gray, marginBottom: 4 }}>הערה</div>
                <input
                  type="text"
                  value={split.notes}
                  onChange={(e) => updateSplit(split.id, "notes", e.target.value)}
                  placeholder="לא חובה"
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: `1px solid ${RISE.grayLine}`,
                    fontSize: 15,
                    color: RISE.ink,
                    outline: "none",
                    textAlign: "start",
                    boxSizing: "border-box",
                    background: "#fff"
                  }}
                />
              </div>
            </div>
          ))}

          {/* Remainder split section */}
          <div style={{ background: isOverTotal ? "#FEF2F2" : "#F0F9FF", border: `1px solid ${isOverTotal ? "#FCA5A5" : "#BAE6FD"}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: isOverTotal ? "#DC2626" : RISE.ink, textAlign: "start" }}>
              {isOverTotal ? "חריגה מהסכום המקורי" : "מה שנשאר"}
            </div>

            {/* Readonly remainder amount input */}
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", insetInlineStart: 14, top: "50%", transform: "translateY(-50%)", color: isOverTotal ? "#DC2626" : RISE.gray, fontSize: 18, fontWeight: 700, pointerEvents: "none" }}>₪</span>
              <input
                type="text"
                readOnly
                value={remainingClamped.toFixed(2)}
                style={{
                  width: "100%",
                  paddingBlock: 14,
                  paddingInlineStart: 42,
                  paddingInlineEnd: 14,
                  borderRadius: 12,
                  border: `1px solid ${isOverTotal ? "#FCA5A5" : "#BAE6FD"}`,
                  fontSize: 16,
                  color: isOverTotal ? "#DC2626" : RISE.ink,
                  background: isOverTotal ? "#FFF5F5" : "#FFFFFF",
                  outline: "none",
                  textAlign: "start",
                  boxSizing: "border-box",
                  fontWeight: 700
                }}
              />
            </div>

            {/* Remainder category dropdown */}
            <div style={{ textAlign: "start" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: RISE.gray, marginBottom: 4 }}>קטגוריה</div>
              <div style={{ position: "relative" }}>
                <select
                  value={remainderCategory}
                  onChange={(e) => setRemainderCategory(e.target.value)}
                  style={{
                    width: "100%",
                    paddingBlock: 14,
                    paddingInlineStart: 14,
                    paddingInlineEnd: 42,
                    borderRadius: 12,
                    border: `1px solid ${RISE.grayLine}`,
                    fontSize: 15,
                    color: RISE.ink,
                    background: "#fff",
                    outline: "none",
                    appearance: "none",
                    boxSizing: "border-box",
                    cursor: "pointer"
                  }}
                >
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <div style={{ position: "absolute", insetInlineEnd: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: RISE.gray }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
              </div>
            </div>

            {/* Remainder note */}
            <div style={{ textAlign: "start" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: RISE.gray, marginBottom: 4 }}>הערה</div>
              <input
                type="text"
                value={remainderNotes}
                onChange={(e) => setRemainderNotes(e.target.value)}
                placeholder="לא חובה"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1px solid ${RISE.grayLine}`,
                  fontSize: 15,
                  color: RISE.ink,
                  outline: "none",
                  textAlign: "start",
                  boxSizing: "border-box",
                  background: "#fff"
                }}
              />
            </div>
          </div>

          {/* Add another split button */}
          {remainingClamped > 0.009 && (
            <button
              type="button"
              onClick={addSplit}
              disabled={!canAddSplit}
              style={{
                background: "none",
                border: `1.5px dashed ${canAddSplit ? RISE.blue : RISE.grayLine}`,
                borderRadius: 14,
                color: canAddSplit ? RISE.blue : RISE.gray,
                fontSize: 15,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justify: "center",
                gap: 8,
                padding: "14px 16px",
                cursor: canAddSplit ? "pointer" : "not-allowed",
                transition: "all 0.2s"
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              להוסיף עוד פיצול
            </button>
          )}
        </div>

        {/* Sticky footer container for bottom summary and CTA button */}
        <div style={{ position: "sticky", bottom: 0, background: "#fff", borderTop: `1px solid ${RISE.grayLine}`, padding: "14px 20px 20px", display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 -4px 16px rgba(0,0,0,0.06)", zIndex: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, color: RISE.gray, fontWeight: 600 }}>
            <span>{isOverTotal ? "חרגתם מהסכום המקורי:" : "נשאר לחלק:"}</span>
            <span style={{ color: isOverTotal ? "#DC2626" : remainingClamped < 0.009 ? RISE.green : RISE.orange, fontWeight: 700, fontSize: 16, direction: "ltr" }}>
              <Money value={isOverTotal ? Math.abs(remaining) : remainingClamped} />
            </span>
          </div>

          <button
            disabled={!isValid || saving}
            onClick={saveSplit}
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: 99,
              border: "none",
              background: isValid ? RISE.blue : RISE.grayLine,
              color: isValid ? "#fff" : RISE.gray,
              fontSize: 17,
              fontWeight: 700,
              cursor: isValid && !saving ? "pointer" : "not-allowed",
              transition: "all 0.2s",
              boxShadow: isValid ? "0 4px 14px rgba(37,99,235,0.3)" : "none"
            }}
          >
            {saving ? "שומר..." : "שמירת הפיצול"}
          </button>
        </div>

      </div>
    </div>
  );
}
