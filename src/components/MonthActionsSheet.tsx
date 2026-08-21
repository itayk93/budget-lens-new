import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { FileSearch, FileUp, MapPinned, Plane, Trash2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenMonths: () => void;
  onOpenImport: () => void;
  onOpenPending: () => void;
  onOpenFoodMap: () => void;
  onOpenFlights: () => void;
  onClose: () => void;
};

export default function MonthActionsSheet({ open, onOpenMonths, onOpenImport, onOpenPending, onOpenFoodMap, onOpenFlights, onClose }: Props) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" dir="rtl" className="h-auto max-w-[480px] mx-auto rounded-t-3xl border-t p-0 text-right">
        <SheetHeader className="border-b px-5 py-4 text-right">
          <SheetTitle className="text-right">פעולות חודשים</SheetTitle>
          <SheetDescription className="text-right">ניהול, ייבוא ומחיקה מרובה של חודשים.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-5 py-5">
          <Button variant="outline" className="w-full flex-row-reverse justify-between" onClick={onOpenMonths}>
            <Trash2 className="h-4 w-4" />
            ניהול חודשים
          </Button>
          <Button variant="outline" className="w-full flex-row-reverse justify-between" onClick={onOpenImport}>
            <FileUp className="h-4 w-4" />
            ייבוא CSV
          </Button>
          <Button variant="outline" className="w-full flex-row-reverse justify-between" onClick={onOpenPending}>
            <FileSearch className="h-4 w-4" />
            רשומות ממתינות
          </Button>
          <Button variant="outline" className="w-full flex-row-reverse justify-between" onClick={onOpenFoodMap}>
            <MapPinned className="h-4 w-4" />
            איפה אכלתי
          </Button>
          <Button variant="outline" className="w-full flex-row-reverse justify-between" onClick={onOpenFlights}>
            <Plane className="h-4 w-4" />
            יומן טיסות
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
