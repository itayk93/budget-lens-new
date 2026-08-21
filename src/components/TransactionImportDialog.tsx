import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ImportResult = {
  parsed: number;
  inserted: number;
  skipped: number;
  months: string[];
};

type Props = {
  open: boolean;
  file: File | null;
  loading: boolean;
  error: string | null;
  result: ImportResult | null;
  onPickFile: (file: File) => void;
  onClose: () => void;
  onStart: () => Promise<void>;
};

export default function TransactionImportDialog({ open, file, loading, error, result, onPickFile, onClose, onStart }: Props) {
  const [started, setStarted] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileLabel = useMemo(() => file?.name || "לא נבחר קובץ", [file]);

  useEffect(() => {
    if (!open) setStarted(false);
  }, [open]);

  useEffect(() => {
    if (!open || !file || started || loading) return;
    void handleStart();
  }, [open, file, started, loading]);

  const handleStart = async () => {
    setStarted(true);
    await onStart();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent dir="rtl" className="w-[95vw] max-w-lg max-h-[90vh] overflow-hidden p-0 text-start">
        <div className="flex h-full flex-col">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-right">
              <Upload className="h-5 w-5" />
              העלאת תזרים ראשי
            </DialogTitle>
            <DialogDescription className="text-right">
              העלה קובץ CSV של רשומות התזרים. הכתיבה תתבצע לשרת עם הרשאות ניהול.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-5">
            <div
              className={cn("rounded-lg border px-4 py-5 transition-colors", dragActive ? "border-primary bg-primary/5" : "bg-muted/30")}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                const dropped = event.dataTransfer.files?.[0];
                if (dropped) onPickFile(dropped);
              }}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4" />
                {fileLabel}
              </div>
              {file && <p className="mt-2 text-xs text-muted-foreground">{Math.round(file.size / 1024)} KB</p>}
              <p className="mt-3 text-xs text-muted-foreground">אפשר לגרור לכאן קובץ CSV או לבחור קובץ מהכפתור למטה.</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const picked = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (picked) onPickFile(picked);
              }}
            />

            <Button variant="outline" className="w-full justify-start" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              בחר קובץ CSV
            </Button>

            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full bg-primary transition-all duration-300", loading || started ? "w-3/4 animate-pulse" : "w-0")}
                />
              </div>
              <div className="text-sm text-muted-foreground">
                <span className={loading ? "modal-loading-dots" : undefined}>
                  {loading ? "מעלה ושומר נתונים" : result ? "ההעלאה הושלמה" : "ממתין להתחלת ההעלאה"}
                </span>
              </div>
            </div>

            {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}

            {result && (
              <div className="grid gap-2 rounded-md border bg-background px-4 py-3 text-sm">
                <div>נבדקו: {result.parsed}</div>
                <div>נוספו: {result.inserted}</div>
                <div>דולגו: {result.skipped}</div>
                <div>חודשים: {result.months.join(", ")}</div>
              </div>
            )}
          </div>

          <DialogFooter className="border-t px-5 py-4">
            <Button variant="outline" onClick={onClose} disabled={loading}>
              <X className="h-4 w-4" />
              ביטול
            </Button>
            <Button onClick={handleStart} disabled={!file || loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {loading ? "מעלה..." : "העלאה"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
