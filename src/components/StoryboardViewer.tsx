import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Layers, Unlink, Download, X, Info, Share2 } from 'lucide-react';
import { useG } from '@/lib/gender';

export interface StoryboardFrame {
  id: string;
  file_path: string;
  original_file_name: string;
  file_type: string;
  width: number | null;
  height: number | null;
  file_size: number | null;
  storyboard_order: number | null;
}

interface StoryboardViewerProps {
  open: boolean;
  onClose: () => void;
  storyboard: { id: string; name: string } | null;
  frames: StoryboardFrame[];
  getPublicUrl: (path: string) => string;
  onDisbanded: () => void;
  onOpenDetails?: (frame: StoryboardFrame) => void;
  isPublic?: boolean;
}

export default function StoryboardViewer({
  open,
  onClose,
  storyboard,
  frames,
  getPublicUrl,
  onDisbanded,
  onOpenDetails,
  isPublic,
}: StoryboardViewerProps) {
  const g = useG();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [disbanding, setDisbanding] = useState<'all' | 'current' | null>(null);
  const [showDisbandDialog, setShowDisbandDialog] = useState(false);
  const [localFrames, setLocalFrames] = useState<StoryboardFrame[]>([]);

  useEffect(() => {
    if (open) {
      setLocalFrames(frames);
    }
  }, [frames, storyboard?.id, open]);

  useEffect(() => {
    if (!open || !storyboard || localFrames.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        // In RTL, left arrow goes next (increases index)
        const nextIdx = currentIndex + 1;
        if (nextIdx < localFrames.length) setCurrentIndex(nextIdx);
      } else if (e.key === 'ArrowRight') {
        // In RTL, right arrow goes previous (decreases index)
        const prevIdx = currentIndex - 1;
        if (prevIdx >= 0) setCurrentIndex(prevIdx);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, currentIndex, storyboard, localFrames]);

  // Reset index when active storyboard changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [storyboard?.id]);

  if (!storyboard || localFrames.length === 0) return null;

  const sortedFrames = [...localFrames].sort((a, b) => (a.storyboard_order ?? 0) - (b.storyboard_order ?? 0));
  const current = sortedFrames[currentIndex] || sortedFrames[0];
  const total = sortedFrames.length;

  const goTo = (idx: number) => {
    if (idx >= 0 && idx < total) setCurrentIndex(idx);
  };

  const handleDisbandAll = async () => {
    if (!storyboard) return;
    setDisbanding('all');
    try {
      // 1. Clear storyboard_id and storyboard_order from all assets
      const { error: updateErr } = await supabase
        .from('assets')
        .update({ storyboard_id: null, storyboard_order: null } as any)
        .eq('storyboard_id', storyboard.id);

      if (updateErr) throw updateErr;

      // 2. Delete the storyboard record
      const { error: deleteErr } = await supabase
        .from('storyboards')
        .delete()
        .eq('id', storyboard.id);

      if (deleteErr) throw deleteErr;

      toast.success(`סטוריבורד "${storyboard.name}" פורק – הנכסים חזרו להיות עצמאיים`);
      setShowDisbandDialog(false);
      onDisbanded();
      onClose();
    } catch (err: any) {
      toast.error('שגיאה בפירוק הסטוריבורד: ' + (err?.message || ''));
    }
    setDisbanding(null);
  };

  const handleRemoveCurrentOnly = async () => {
    if (!storyboard || !current) return;
    setDisbanding('current');
    try {
      if (total <= 2) {
        // 1. Clear storyboard_id and storyboard_order from all assets
        const { error: updateErr } = await supabase
          .from('assets')
          .update({ storyboard_id: null, storyboard_order: null } as any)
          .eq('storyboard_id', storyboard.id);

        if (updateErr) throw updateErr;

        // 2. Delete the storyboard record
        const { error: deleteErr } = await supabase
          .from('storyboards')
          .delete()
          .eq('id', storyboard.id);

        if (deleteErr) throw deleteErr;

        toast.success(`הפריים הוסר והסטוריבורד פורק בהצלחה`);
        setShowDisbandDialog(false);
        onDisbanded();
        onClose();
        setDisbanding(null);
        return;
      }

      // 1. Remove current frame from storyboard
      const { error: removeErr } = await supabase
        .from('assets')
        .update({ storyboard_id: null, storyboard_order: null } as any)
        .eq('id', current.id);

      if (removeErr) throw removeErr;

      // 2. Sort remaining and update order
      const remainingFrames = sortedFrames.filter(f => f.id !== current.id);
      const updates = remainingFrames.map((frame, idx) =>
        supabase
          .from('assets')
          .update({ storyboard_order: idx } as any)
          .eq('id', frame.id)
      );
      await Promise.all(updates);

      // 3. Update cover_asset_id if the removed frame was the cover
      const { data: sbData } = await supabase
        .from('storyboards')
        .select('cover_asset_id')
        .eq('id', storyboard.id)
        .single();
      
      if (sbData && sbData.cover_asset_id === current.id) {
        await supabase
          .from('storyboards')
          .update({ cover_asset_id: remainingFrames[0].id } as any)
          .eq('id', storyboard.id);
      }

      toast.success(`הנכס "${current.original_file_name}" הוסר מהסטוריבורד בהצלחה`);
      setShowDisbandDialog(false);

      // Update local state in modal so it stays open with updated list
      setLocalFrames(remainingFrames);
      if (currentIndex >= remainingFrames.length) {
        setCurrentIndex(Math.max(0, remainingFrames.length - 1));
      }

      // Notify parent to fetch new data in the background
      onDisbanded();
    } catch (err: any) {
      toast.error('שגיאה בהסרת הנכס: ' + (err?.message || ''));
    }
    setDisbanding(null);
  };

  const handleDownload = async () => {
    try {
      const url = getPublicUrl(current.file_path);
      const a = document.createElement('a');
      a.href = `${url}?download=${encodeURIComponent(current.original_file_name)}`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(g('ההורדה החלה בהצלחה'));
    } catch {
      toast.error('שגיאה בהורדת הקובץ');
    }
  };
  const handleShare = async () => {
    try {
      const url = `${window.location.origin}/public/storyboard/${storyboard.id}`;
      await navigator.clipboard.writeText(url);
      toast.success(g('קישור הועתק בהצלחה'));
    } catch {
      toast.error(g('שגיאה בהעתקת הקישור'));
    }
  };

  const content = (
    <>
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 pb-2 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
            <div className="flex items-center gap-2 min-w-0 pe-8 sm:pe-0">
              <Layers className="w-4 h-4 text-primary shrink-0" />
              {isPublic ? (
                <h2 className="text-sm sm:text-base truncate font-semibold">{storyboard.name}</h2>
              ) : (
                <DialogTitle className="text-sm sm:text-base truncate">{storyboard.name}</DialogTitle>
              )}
              <span className="text-xs text-muted-foreground shrink-0">
                ({currentIndex + 1}/{total})
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0 sm:pe-8 pb-1 sm:pb-0">
              {!isPublic && onOpenDetails && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenDetails(current)} title={g('פרטי נכס')}>
                  <Info className="w-4 h-4" />
                </Button>
              )}
              {!isPublic && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleShare} title={g('שיתוף קישור')}>
                  <Share2 className="w-4 h-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDownload} title={g('הורדה')}>
                <Download className="w-4 h-4" />
              </Button>
              {!isPublic && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setShowDisbandDialog(true)}
                  title={g('פרק סטוריבורד / הסר נכס')}
                >
                  <Unlink className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
          {isPublic ? null : (
            <DialogDescription className="sr-only">
              {g('תצוגת סטוריבורד עם ניווט בין פריימים')}
            </DialogDescription>
          )}
      </div>

        {/* Main image area */}
        <div className="flex-1 min-h-0 relative flex items-center justify-center bg-muted/30 overflow-hidden">
          {/* Navigation arrows */}
          {currentIndex > 0 && (
            <button
              onClick={() => goTo(currentIndex - 1)}
              className="absolute start-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-background/80 backdrop-blur shadow-md border flex items-center justify-center hover:bg-background transition-colors cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
          {currentIndex < total - 1 && (
            <button
              onClick={() => goTo(currentIndex + 1)}
              className="absolute end-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-background/80 backdrop-blur shadow-md border flex items-center justify-center hover:bg-background transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          {/* Image */}
          {current.file_type.startsWith('image') ? (
            <img
              src={getPublicUrl(current.file_path)}
              alt={current.original_file_name}
              className="max-w-full max-h-[45vh] sm:max-h-[60vh] object-contain transition-opacity duration-300"
            />
          ) : current.file_type.startsWith('video') ? (
            <video
              key={current.id}
              src={getPublicUrl(current.file_path)}
              controls
              className="max-w-full max-h-[45vh] sm:max-h-[60vh]"
            />
          ) : (
            <div className="text-muted-foreground text-sm p-8">{current.file_type}</div>
          )}
        </div>

        {/* Frame info */}
        <div className="shrink-0 px-4 py-1.5 text-xs text-muted-foreground border-t bg-muted/20 flex items-center justify-between">
          <span className="truncate">{current.original_file_name}</span>
          {current.width && current.height && (
            <span dir="ltr" className="shrink-0 ms-3">{current.width}×{current.height}</span>
          )}
        </div>

        {/* Thumbnails bar */}
        <div className="shrink-0 border-t bg-background px-2 py-2 overflow-x-auto">
          <div className="flex gap-1.5 justify-start">
            {sortedFrames.map((frame, idx) => (
              <button
                key={frame.id}
                onClick={() => goTo(idx)}
                className={`shrink-0 w-12 h-12 sm:w-16 sm:h-16 rounded-md overflow-hidden border-2 transition-all cursor-pointer ${
                  idx === currentIndex
                    ? 'border-primary ring-1 ring-primary/30 shadow-sm'
                    : 'border-transparent hover:border-muted-foreground/30 opacity-70 hover:opacity-100'
                }`}
              >
                {frame.file_type.startsWith('image') ? (
                  <img
                    src={getPublicUrl(frame.file_path)}
                    alt={`פריים ${idx + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted text-lg font-semibold text-muted-foreground">
                    {idx + 1}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
    </>
  );

  if (isPublic) {
    return (
      <div className="fixed inset-0 bg-background/50 flex items-center justify-center p-0 sm:p-4 z-50 backdrop-blur-sm" dir="rtl">
        <div className="w-full h-full sm:max-w-4xl sm:max-h-[96vh] bg-background sm:rounded-lg sm:border sm:shadow-lg flex flex-col overflow-hidden">
          {content}
        </div>
      </div>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent
          dir="rtl"
          className="max-w-4xl w-[92vw] sm:w-[98vw] max-h-[90vh] sm:max-h-[96vh] flex flex-col text-start p-0 gap-0 overflow-hidden"
        >
          <DialogHeader className="p-0 m-0 space-y-0">
             {content}
          </DialogHeader>
        </DialogContent>
      </Dialog>

    <Dialog open={showDisbandDialog} onOpenChange={setShowDisbandDialog}>
      <DialogContent dir="rtl" className="text-start max-w-md w-[95vw] p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>פירוק סטוריבורד או הסרת פריים</DialogTitle>
          <DialogDescription>
            האם ברצונך לפרק את הסטוריבורד "{storyboard.name}" כולו, או רק להוציא את הנכס הנוכחי מתוכו?
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 text-xs sm:text-sm text-muted-foreground space-y-2">
          <p>
            <strong>פרק סטוריבורד כולו:</strong> יפרק את הקבוצה וכל {total} הנכסים יחזרו להיות עצמאיים.
          </p>
          <p>
            <strong>הוצא פריים נוכחי:</strong> יוציא רק את הנכס <strong>"{current.original_file_name}"</strong>. שאר הנכסים יישארו קבוצתיים.
            {total <= 2 && (
              <span className="block text-amber-600 font-medium mt-1">
                * שימוש באפשרות זו יפרק את הסטוריבורד כולו מאחר שייוותר בו פריים בודד בלבד.
              </span>
            )}
          </p>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 justify-start mt-4 pt-4 border-t" dir="rtl">
          <Button
            variant="destructive"
            onClick={handleDisbandAll}
            disabled={disbanding !== null}
            className="text-xs sm:text-sm w-full sm:w-auto"
          >
            {disbanding === 'all' ? 'מפרק...' : 'פרק סטוריבורד כולו'}
          </Button>
          <Button
            variant="outline"
            onClick={handleRemoveCurrentOnly}
            disabled={disbanding !== null}
            className="text-xs sm:text-sm w-full sm:w-auto border-primary text-primary hover:bg-primary/5 hover:text-primary"
          >
            {disbanding === 'current' ? 'מוציא...' : 'הוצא פריים נוכחי'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setShowDisbandDialog(false)}
            disabled={disbanding !== null}
            className="text-xs sm:text-sm w-full sm:w-auto sm:ms-auto"
          >
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
  );
}
