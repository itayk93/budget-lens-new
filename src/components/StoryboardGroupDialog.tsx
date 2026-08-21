import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Layers, ArrowUp, ArrowDown, Loader2, GripVertical } from 'lucide-react';
import { useG } from '@/lib/gender';

export interface StoryboardAsset {
  id: string;
  file_path: string;
  original_file_name: string;
  file_type: string;
  width?: number | null;
  height?: number | null;
}

interface StoryboardGroupDialogProps {
  open: boolean;
  onClose: () => void;
  selectedAssets: StoryboardAsset[];
  getPublicUrl: (path: string) => string;
  onCreated: () => void;
}

export default function StoryboardGroupDialog({
  open,
  onClose,
  selectedAssets,
  getPublicUrl,
  onCreated,
}: StoryboardGroupDialogProps) {
  const g = useG();
  const [name, setName] = useState('');
  const [frames, setFrames] = useState<StoryboardAsset[]>(selectedAssets);
  const [saving, setSaving] = useState(false);

  // Reset state when dialog opens with new assets
  const [lastAssetIds, setLastAssetIds] = useState('');
  const currentIds = selectedAssets.map(a => a.id).sort().join(',');
  if (currentIds !== lastAssetIds) {
    setLastAssetIds(currentIds);
    setFrames([...selectedAssets]);
    setName('');
  }

  const moveFrame = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= frames.length) return;
    const updated = [...frames];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setFrames(updated);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('יש להזין שם לסטוריבורד');
      return;
    }
    if (frames.length < 2) {
      toast.error('נדרשים לפחות 2 נכסים ליצירת סטוריבורד');
      return;
    }

    setSaving(true);
    try {
      // 1. Create storyboard record
      const { data: sb, error: sbError } = await supabase
        .from('storyboards')
        .insert({ name: trimmedName, cover_asset_id: frames[0].id } as any)
        .select()
        .single();

      if (sbError || !sb) {
        toast.error('שגיאה ביצירת סטוריבורד: ' + (sbError?.message || ''));
        setSaving(false);
        return;
      }

      // 2. Update each asset with storyboard_id and order
      const updates = frames.map((frame, idx) =>
        supabase
          .from('assets')
          .update({ storyboard_id: sb.id, storyboard_order: idx } as any)
          .eq('id', frame.id)
      );
      await Promise.all(updates);

      toast.success(`סטוריבורד "${trimmedName}" נוצר עם ${frames.length} פריימים`);
      onCreated();
      onClose();
    } catch (err: any) {
      toast.error('שגיאה ביצירת סטוריבורד: ' + (err?.message || ''));
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-lg w-[95vw] max-h-[92vh] flex flex-col text-start p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5" />
            קיבוץ כסטוריבורד
          </DialogTitle>
          <DialogDescription>
            {g('בחר שם לסטוריבורד וסדר את הפריימים')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
          {/* Name input */}
          <div className="space-y-1.5 shrink-0">
            <Label htmlFor="sb-name">שם הסטוריבורד</Label>
            <Input
              id="sb-name"
              placeholder="לדוגמה: מחזור אשראי - סטוריליין..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              autoFocus
            />
          </div>

          {/* Frames list */}
          <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
            <Label>סדר פריימים ({frames.length})</Label>
            <div className="flex-1 min-h-0 overflow-y-auto border rounded-md divide-y">
              {frames.map((frame, index) => (
                <div
                  key={frame.id}
                  className="flex items-center gap-3 p-2 hover:bg-accent/50 transition-colors group"
                >
                  {/* Order number */}
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {index + 1}
                  </div>

                  {/* Thumbnail */}
                  <div className="w-12 h-12 rounded-md overflow-hidden bg-muted shrink-0">
                    {frame.file_type.startsWith('image') ? (
                      <img
                        src={getPublicUrl(frame.file_path)}
                        alt={frame.original_file_name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[9px] text-muted-foreground">
                        {frame.file_type.split('/')[1]}
                      </div>
                    )}
                  </div>

                  {/* File name */}
                  <span className="text-xs truncate flex-1 min-w-0">{frame.original_file_name}</span>

                  {/* Reorder buttons */}
                  <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={index === 0}
                      onClick={() => moveFrame(index, -1)}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={index === frames.length - 1}
                      onClick={() => moveFrame(index, 1)}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="justify-start gap-2 shrink-0 border-t pt-4 mt-2">
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin ms-2" />
                {g('שומר...')}
              </>
            ) : (
              <>
                <Layers className="w-4 h-4 ms-2" />
                {g('צור סטוריבורד')}
              </>
            )}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
