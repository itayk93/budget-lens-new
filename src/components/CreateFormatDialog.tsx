import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useG } from '@/lib/gender';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultName?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  onCreated: (info: { channelId: string; channelName: string; size: any }) => void;
}

export default function CreateFormatDialog({ open, onClose, defaultName, defaultWidth, defaultHeight, onCreated }: Props) {
  const g = useG();
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [maxWidth, setMaxWidth] = useState('');
  const [widthOnly, setWidthOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName || '');
      setWidth(defaultWidth ? String(defaultWidth) : '');
      setHeight(defaultHeight ? String(defaultHeight) : '');
      setMaxWidth('');
      setWidthOnly(false);
      setSaving(false);
    }
  }, [open, defaultName, defaultWidth, defaultHeight]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error(g('הזן שם פורמט')); return; }
    const w = parseInt(width);
    if (!w || w <= 0) { toast.error(g('הזן רוחב תקין')); return; }
    let h = 0;
    if (!widthOnly) {
      h = parseInt(height);
      if (!h || h <= 0) { toast.error(g('הזן גובה תקין')); return; }
    }
    const mw = widthOnly && maxWidth ? parseInt(maxWidth) : null;
    if (mw !== null && (mw <= 0 || mw < w)) { toast.error('רוחב מקסימלי חייב להיות גדול מהרוחב'); return; }
    setSaving(true);
    try {
      // Try to find existing channel with same name (case-insensitive)
      const { data: existing } = await supabase
        .from('media_channels')
        .select('id, name')
        .ilike('name', name.trim())
        .maybeSingle();
      let channelId: string;
      let channelName: string;
      if (existing) {
        channelId = (existing as any).id;
        channelName = (existing as any).name;
      } else {
        const { data, error } = await supabase
          .from('media_channels')
          .insert({ name: name.trim(), description: '' })
          .select()
          .single();
        if (error || !data) { toast.error('שגיאה ביצירת פורמט'); setSaving(false); return; }
        channelId = (data as any).id;
        channelName = (data as any).name;
      }
      const { data: sizeData, error: sizeError } = await supabase
        .from('channel_sizes')
        .insert({
          channel_id: channelId,
          width: w,
          height: widthOnly ? 0 : h,
          max_width: mw,
          description: '',
          width_only: widthOnly,
        })
        .select('*, media_channels(id, name)')
        .single();
      if (sizeError || !sizeData) { toast.error('שגיאה ביצירת מידה'); setSaving(false); return; }
      toast.success('פורמט נוצר');
      onCreated({ channelId, channelName, size: sizeData });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-md z-[70]">
        <DialogHeader>
          <DialogTitle className="text-right">פורמט חדש</DialogTitle>
          <DialogDescription className="text-right">
            המידות נטענו מהקובץ שהעלית. ניתן לערוך לפני שמירה.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="cf-name">שם פורמט</Label>
            <Input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: Facebook" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="cf-wo" checked={widthOnly} onCheckedChange={(v) => setWidthOnly(!!v)} />
            <Label htmlFor="cf-wo" className="cursor-pointer">רוחב קבוע, גובה משתנה</Label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="cf-w">רוחב (px)</Label>
              <Input id="cf-w" type="number" value={width} onChange={(e) => setWidth(e.target.value)} />
            </div>
            {widthOnly ? (
              <div>
                <Label htmlFor="cf-mw">רוחב מקסימלי (אופציונלי)</Label>
                <Input id="cf-mw" type="number" value={maxWidth} onChange={(e) => setMaxWidth(e.target.value)} />
              </div>
            ) : (
              <div>
                <Label htmlFor="cf-h">גובה (px)</Label>
                <Input id="cf-h" type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? g('שומר...') : g('צור פורמט')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}