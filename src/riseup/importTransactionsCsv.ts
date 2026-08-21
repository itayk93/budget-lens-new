export type ImportResult = {
  parsed: number;
  inserted: number;
  skipped: number;
  rows: Array<{
    id: string;
    flow_month: string | null;
  }>;
  months: string[];
};

export async function importTransactionsCsv(text: string): Promise<ImportResult> {
  const response = await fetch("/api/import-transactions-csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "ייבוא הקובץ נכשל");
  }
  return payload as ImportResult;
}

export async function deleteTransactionsMonths(months: string[]): Promise<{ deleted: number; months: string[] }> {
  const response = await fetch("/api/delete-transactions-months", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ months }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "מחיקת החודשים נכשלה");
  }
  return payload;
}
