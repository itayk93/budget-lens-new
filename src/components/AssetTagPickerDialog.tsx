import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Sparkles, Loader2, Plus, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useG } from '@/lib/gender';

interface TagOption {
  id: string;
  name: string;
  parent_id: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  assetIds: string[];
  currentTagIds: string[];
  fileName: string;
  fileType: string;
  width: number | null;
  height: number | null;
  publicUrl?: string | null;
  onSaved: (newTagIds: string[]) => void;
}

export default function AssetTagPickerDialog({
  open,
  onClose,
  assetIds,
  currentTagIds,
  fileName,
  fileType,
  width,
  height,
  publicUrl,
  onSaved,
}: Props) {
  const g = useG();
  const [availableTags, setAvailableTags] = useState<TagOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedTagIds, setSuggestedTagIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelected(currentTagIds);
    setSuggestedTagIds([]);
    setSearch('');
    supabase
      .from('tags')
      .select('id, name, parent_id')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setAvailableTags((data as any) || []));
  }, [open, currentTagIds]);

  const toggle = (tagId: string) =>
    setSelected((prev) => (prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]));

  const parentTags = availableTags.filter((t) => !t.parent_id);
  const getChildrenOf = (parentId: string) => availableTags.filter((t) => t.parent_id === parentId);
  const parentsWithChildren = parentTags.filter((p) => getChildrenOf(p.id).length > 0);
  const standaloneParents = parentTags.filter((p) => getChildrenOf(p.id).length === 0);
  const q = search.trim().toLowerCase();

  const filteredParentsWithChildren = q
    ? parentsWithChildren.filter(
        (p) =>
          p.name.toLowerCase().includes(q) || getChildrenOf(p.id).some((c) => c.name.toLowerCase().includes(q)),
      )
    : parentsWithChildren;

  const filteredStandalone = q
    ? standaloneParents.filter((t) => t.name.toLowerCase().includes(q))
    : standaloneParents;

  const filteredChildrenOf = (parentId: string) => {
    const children = getChildrenOf(parentId);
    if (!q) return children;
    const parent = availableTags.find((t) => t.id === parentId);
    if (parent?.name.toLowerCase().includes(q)) return children;
    return children.filter((c) => c.name.toLowerCase().includes(q));
  };

  const showCreate =
    search.trim().length > 0 &&
    !availableTags.some((t) => t.name.toLowerCase() === search.trim().toLowerCase());

  const handleCreate = async () => {
    const name = search.trim();
    if (!name) return;
    setAdding(true);
    const { data, error } = await supabase
      .from('tags')
      .insert({ name } as any)
      .select('id, name, parent_id')
      .single();
    setAdding(false);
    if (error) {
      toast.error('לא הצלחנו להוסיף את התגית');
      return;
    }
    setAvailableTags((prev) => [...prev, data as any]);
    setSelected((prev) => [...prev, (data as any).id]);
    setSearch('');
  };

  const fileToDataUrl = async (url: string): Promise<string | undefined> => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      if (blob.size > 5 * 1024 * 1024) return undefined;
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(blob);
      });
    } catch {
      return undefined;
    }
  };

  const suggestTags = async () => {
    setSuggesting(true);
    try {
      let imageDataUrl: string | undefined;
      if (fileType.startsWith('image/') && publicUrl) {
        imageDataUrl = await fileToDataUrl(publicUrl);
      }
      const { data, error } = await supabase.functions.invoke('suggest-tags', {
        body: { fileName, fileType, width, height, imageDataUrl },
      });
      if (error) throw error;
      const valid = Array.isArray(data?.tagIds)
        ? (data.tagIds as string[]).filter((tid) => availableTags.some((tag) => tag.id === tid))
        : [];
      setSuggestedTagIds(valid);
      if (valid.length === 0) toast.info('לא נמצאו תגיות מוצעות לקובץ');
      else toast.success(`נמצאו ${valid.length} תגיות מוצעות`);
    } catch {
      toast.error('שגיאה בהצעת תגיות');
    } finally {
      setSuggesting(false);
    }
  };

  const mergeSuggested = (ids: string[]) => {
    setSelected((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const handleSave = async () => {
    const toAdd = selected.filter((id) => !currentTagIds.includes(id));
    const toRemove = currentTagIds.filter((id) => !selected.includes(id));
    setSaving(true);
    try {
      if (toAdd.length > 0) {
        const { data: existing } = await supabase.from('asset_tags').select('asset_id, tag_id').in('asset_id', assetIds).in('tag_id', toAdd);
        const existingSet = new Set((existing || []).map(r => `${r.asset_id}_${r.tag_id}`));
        const rows = assetIds.flatMap(aid => toAdd.map(tag_id => ({ asset_id: aid, tag_id }))).filter(r => !existingSet.has(`${r.asset_id}_${r.tag_id}`));
        if (rows.length > 0) {
          const { error } = await supabase.from('asset_tags').insert(rows as any);
          if (error) {
            console.error('Insert error:', error);
            throw error;
          }
        }
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('asset_tags')
          .delete()
          .in('asset_id', assetIds)
          .in('tag_id', toRemove);
        if (error) throw error;
      }
      toast.success('התגיות עודכנו');
      onSaved(selected);
      onClose();
    } catch (e: any) {
      toast.error('שגיאה בשמירת התגיות');
    } finally {
      setSaving(false);
    }
  };

  const suggestedTags = suggestedTagIds
    .map((tid) => availableTags.find((t) => t.id === tid))
    .filter(Boolean) as TagOption[];
  const notSelectedSuggested = suggestedTagIds.filter((tid) => !selected.includes(tid));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl" className="w-[95vw] max-w-lg max-h-[92vh] flex flex-col text-start p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle>סיווג תגיות לנכס</DialogTitle>
        </DialogHeader>

        {selected.length > 0 && (
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">תגיות נבחרות ({selected.length})</div>
            <div className="flex flex-wrap gap-1 rounded-md border bg-muted/30 p-2 max-h-32 overflow-y-auto">
              {selected.map((tid) => {
                const tag = availableTags.find((t) => t.id === tid);
                if (!tag) return null;
                return (
                  <Badge key={tid} variant="secondary" className="gap-1 px-1.5 py-0 text-[11px]">
                    {tag.name}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(tid);
                      }}
                      className="hover:text-destructive transition-colors"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 pt-1 pb-3 min-h-0 overflow-y-auto">
          <div className="flex items-center gap-2">
            <div className="flex-1 border rounded-md overflow-hidden">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder={g("חפש תגית או הקלד שם חדש...")}
                  className="h-9 text-sm"
                  value={search}
                  onValueChange={setSearch}
                />
                <CommandList className="max-h-64 overflow-y-auto">
                  {filteredParentsWithChildren.map((parent) => (
                    <CommandGroup key={parent.id} heading={parent.name}>
                      {filteredChildrenOf(parent.id).map((tag) => (
                        <CommandItem
                          key={tag.id}
                          value={tag.name}
                          onSelect={() => toggle(tag.id)}
                          className="text-xs"
                        >
                          <div
                            className={`w-3.5 h-3.5 rounded border me-2 flex-shrink-0 flex items-center justify-center transition-all ${
                              selected.includes(tag.id)
                                ? 'bg-primary border-primary'
                                : 'border-input hover:border-primary/50'
                            }`}
                          >
                            {selected.includes(tag.id) && <Check className="w-2 h-2 text-primary-foreground" />}
                          </div>
                          {tag.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                  {filteredStandalone.length > 0 && (
                    <CommandGroup heading="כללי">
                      {filteredStandalone.map((tag) => (
                        <CommandItem
                          key={tag.id}
                          value={tag.name}
                          onSelect={() => toggle(tag.id)}
                          className="text-xs"
                        >
                          <div
                            className={`w-3.5 h-3.5 rounded border me-2 flex-shrink-0 flex items-center justify-center transition-all ${
                              selected.includes(tag.id)
                                ? 'bg-primary border-primary'
                                : 'border-input hover:border-primary/50'
                            }`}
                          >
                            {selected.includes(tag.id) && <Check className="w-2 h-2 text-primary-foreground" />}
                          </div>
                          {tag.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {filteredParentsWithChildren.length === 0 && filteredStandalone.length === 0 && !showCreate && (
                    <div className="text-xs p-3 text-center text-muted-foreground">לא נמצאו תגיות</div>
                  )}
                  {showCreate && (
                    <CommandGroup>
                      <CommandItem
                        onSelect={handleCreate}
                        className="text-xs text-primary font-medium bg-primary/5 hover:bg-primary/10"
                        disabled={adding}
                      >
                        <Plus className="w-3.5 h-3.5 ms-2 flex-shrink-0" />
                        {adding ? g('מוסיף...') : `צור תגית חדשה: "${search.trim()}"`}
                      </CommandItem>
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </div>
          </div>
          
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            onClick={suggestTags}
            disabled={suggesting || assetIds.length > 1}
          >
            {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {g('קבל הצעות לתגיות עם AI')}
          </Button>

          {suggestedTags.length > 0 && (
            <div className="rounded-md border bg-muted/20 p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">הצעות AI</span>
                {notSelectedSuggested.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => mergeSuggested(notSelectedSuggested)}
                  >
                    הוסף הכל
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {suggestedTags.map((tag) => {
                  const already = selected.includes(tag.id);
                  return (
                    <Button
                      key={tag.id}
                      type="button"
                      variant={already ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-6 gap-1 px-2 text-[11px]"
                      disabled={already}
                      onClick={() => mergeSuggested([tag.id])}
                    >
                      {!already && <Plus className="h-3 w-3" />}
                      {tag.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        <DialogFooter className="flex-row gap-2 justify-end sm:justify-end shrink-0 border-t pt-3 mt-1">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            ביטול
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? <Loader2 className="h-4 w-4 animate-spin ms-1" /> : null}
            שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}