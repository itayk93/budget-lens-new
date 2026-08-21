import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Archive, RotateCcw, Upload, Pencil, Trash2, Check, X, Tag, Search, ChevronDown, ChevronUp, Filter } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { selectAll } from '@/lib/supabaseFetch';

interface TagRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  asset_count: number;
  parent_id: string | null;
}

export default function TagManagementPanel() {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagParent, setNewTagParent] = useState<string>('none');
  const [showArchived, setShowArchived] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [sortMode, setSortMode] = useState<'alpha' | 'amount'>('alpha');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [showOnlyUnused, setShowOnlyUnused] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchTags(); }, []);

  const fetchTags = async () => {
    const [tagsData, countsData] = await Promise.all([
      selectAll<any>((from, to) => supabase.from('tags').select('*').order('name').range(from, to)),
      selectAll<any>((from, to) => supabase.from('asset_tags').select('tag_id').range(from, to)),
    ]);
    const countMap = new Map<string, number>();
    countsData.forEach((at: any) => {
      countMap.set(at.tag_id, (countMap.get(at.tag_id) || 0) + 1);
    });
    setTags(tagsData.map((t: any) => ({
      ...t,
      asset_count: countMap.get(t.id) || 0,
    })));
  };

  const handleAddTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    
    const baseSlug = name.toLowerCase().replace(/\s+/g, '-');
    let slug = baseSlug;
    let counter = 1;
    while (tags.some(t => t.slug === slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const insertData: any = { name, slug };
    const { error } = await supabase.from('tags').insert(insertData as any).select().single();
    if (error) {
      if (error.code === '23505') toast.error('תגית דומה כבר קיימת');
      else toast.error('לא הצלחנו להוסיף את התגית: ' + error.message);
      return;
    }
    toast.success(`התגית "${name}" נוספה בהצלחה`);
    setNewTagName('');
    setIsAddModalOpen(false);
    fetchTags();
  };

  const handleArchiveTag = async (tag: TagRow) => {
    const { error } = await supabase.from('tags').update({ is_active: false } as any).eq('id', tag.id);
    if (error) { toast.error('לא הצלחנו לארכב את התגית'); return; }
    if (tag.asset_count > 0) {
      toast.success(`התגית "${tag.name}" הועברה לארכיון. היא עדיין מופיעה על ${tag.asset_count} נכסים קיימים.`);
    } else {
      toast.success(`התגית "${tag.name}" הועברה לארכיון`);
    }
    fetchTags();
  };

  const handleRestoreTag = async (tag: TagRow) => {
    await supabase.from('tags').update({ is_active: true } as any).eq('id', tag.id);
    toast.success(`התגית "${tag.name}" הופעלה מחדש`);
    fetchTags();
  };

  const handleUpdateTag = async (tagId: string) => {
    const name = editingTagName.trim();
    if (!name) return;
    const { error } = await supabase.from('tags').update({ name } as any).eq('id', tagId);
    if (error) { toast.error('לא הצלחנו לעדכן את התגית: ' + error.message); return; }
    toast.success('התגית עודכנה בהצלחה');
    setEditingTagId(null);
    fetchTags();
  };

  const handleDeleteTag = async (tagId: string) => {
    const { error } = await supabase.from('tags').delete().eq('id', tagId);
    if (error) { toast.error('לא הצלחנו למחוק את התגית: ' + error.message); return; }
    toast.success('התגית נמחקה לצמיתות');
    setSelectedTagIds(prev => prev.filter(id => id !== tagId));
    fetchTags();
  };

  const handleBulkDeleteTags = async () => {
    if (selectedTagIds.length === 0) return;
    const { error } = await supabase.from('tags').delete().in('id', selectedTagIds);
    if (error) { toast.error('לא הצלחנו למחוק את התגיות: ' + error.message); return; }
    toast.success('התגיות נמחקו לצמיתות');
    setSelectedTagIds([]);
    fetchTags();
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const startIdx = lines[0]?.toLowerCase().includes('name') ? 1 : 0;
      let added = 0;
      let skipped = 0;
      for (let i = startIdx; i < lines.length; i++) {
        const name = lines[i].replace(/^["']|["']$/g, '').trim();
        if (!name) continue;
        const { error } = await supabase.from('tags').insert({ name } as any);
        if (error) skipped++; else added++;
      }
      toast.success(`יובאו ${added} תגיות. ${skipped > 0 ? `${skipped} דולגו (כפילויות).` : ''}`);
      fetchTags();
    };
    reader.readAsText(file);
  };

  const visibleTags = (showArchived ? tags : tags.filter(t => t.is_active))
    .filter(t => t.name.toLowerCase().includes(tagSearch.toLowerCase()) || (t.slug || '').toLowerCase().includes(tagSearch.toLowerCase()))
    .filter(t => showOnlyUnused ? t.asset_count === 0 : true);
  const archivedCount = tags.filter(t => !t.is_active).length;
  const unusedCount = tags.filter(t => t.is_active && t.asset_count === 0).length;
  const sortedVisibleTags = [...visibleTags].sort((a, b) => {
    if (sortMode === 'amount') {
      return b.asset_count - a.asset_count;
    }
    return a.name.localeCompare(b.name, 'he');
  });

  return (
    <Card dir="rtl">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">ניהול תגיות (טקסונומיה)</CardTitle>
          <div className="flex gap-2">
            {selectedTagIds.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="gap-2">
                    <Trash2 className="w-4 h-4" />
                    מחיקת נבחרים ({selectedTagIds.length})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent dir="rtl">
                  <AlertDialogHeader>
                    <AlertDialogTitle>למחוק {selectedTagIds.length} תגיות?</AlertDialogTitle>
                    <AlertDialogDescription>
                      התגיות ימחקו לצמיתות, וכל השיוכים לנכסים יוסרו מכולן. פעולה זו אינה הפיכה.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="flex-row gap-2 justify-end sm:justify-end">
                    <AlertDialogCancel className="mt-0">ביטול</AlertDialogCancel>
                    <AlertDialogAction onClick={handleBulkDeleteTags} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      מחיקה לצמיתות
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button variant="outline" size="sm" className="gap-2" onClick={() => csvRef.current?.click()}>
              <Upload className="w-4 h-4" />
              ייבוא CSV
            </Button>
            <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
            {archivedCount > 0 && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowArchived(!showArchived)}>
                <Archive className="w-4 h-4" />
                {showArchived ? 'הסתרת ארכיון' : `ארכיון (${archivedCount})`}
              </Button>
            )}
            <Button
              variant={showOnlyUnused ? 'default' : 'outline'}
              size="sm"
              className="gap-2"
              onClick={() => {
                setShowOnlyUnused(!showOnlyUnused);
                setSelectedTagIds([]);
              }}
            >
              <Tag className="w-4 h-4" />
              {showOnlyUnused ? 'הצג הכל' : `תגיות ריקות (${unusedCount})`}
            </Button>
            {showOnlyUnused && sortedVisibleTags.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setSelectedTagIds(sortedVisibleTags.map(t => t.id))}
              >
                <Check className="w-4 h-4" />
                בחר את כל הריקות
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          התגיות כאן הן אותן תגיות שמופיעות במסך העלאת קבצים. הוספה כאן תוסיף אותן גם שם.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          variant="outline" 
          className="w-full md:hidden flex justify-between items-center"
          onClick={() => setIsMobileFiltersOpen(!isMobileFiltersOpen)}
        >
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4" />
            <span>סינון והוספת תגיות</span>
          </div>
          {isMobileFiltersOpen ? <ChevronUp className="w-4 h-4 opacity-50" /> : <ChevronDown className="w-4 h-4 opacity-50" />}
        </Button>
        <div className={`flex flex-col sm:flex-row gap-2 items-start sm:items-end flex-wrap ${!isMobileFiltersOpen ? 'hidden md:flex' : 'flex'}`}>
          <div className="space-y-1 w-full sm:w-auto relative">
            <Label className="text-xs">חיפוש תגיות</Label>
            <div className="relative">
              <Search className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="חפש לפי שם או slug..."
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                className="w-full sm:w-48 pe-8"
              />
            </div>
          </div>
          <div className="space-y-1 w-full sm:w-auto">
            <Label className="text-xs">מיון תגיות</Label>
            <Select value={sortMode} onValueChange={(val: any) => setSortMode(val)}>
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue placeholder="בחר מיון" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="amount">לפי כמות</SelectItem>
                <SelectItem value="alpha">א׳-ב׳</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 w-full sm:w-auto mt-auto">
            <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
              <DialogTrigger asChild>
                <Button className="w-full sm:w-auto gap-2">
                  <Plus className="w-4 h-4" />
                  להוספה
                </Button>
              </DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader>
                  <DialogTitle>הוספת תגית חדשה</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>שם תגית</Label>
                    <Input
                      placeholder="שם תגית..."
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (!newTagName.trim()) { toast.error('יש להזין שם תגית חדשה'); return; }
                          handleAddTag();
                        }
                      }}
                      autoFocus
                    />
                  </div>
                </div>
                <DialogFooter className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>ביטול</Button>
                  <Button onClick={() => {
                    if (!newTagName.trim()) { toast.error('יש להזין שם תגית חדשה'); return; }
                    handleAddTag();
                  }}>
                    שמירה
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {sortedVisibleTags.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-2 bg-muted/20 rounded-md border border-dashed">
            <Tag className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">עוד אין תגיות</p>
            <p className="text-xs text-muted-foreground">התגיות שישמרו יופיעו כאן. אפשר להוסיף תגית חדשה למעלה.</p>
          </div>
        ) : (
          <>
            <div className="hidden md:block rounded-md border overflow-hidden">
              <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-10 text-center">
                    <Checkbox
                      checked={sortedVisibleTags.length > 0 && selectedTagIds.length === sortedVisibleTags.length}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedTagIds(sortedVisibleTags.map(t => t.id));
                        } else {
                          setSelectedTagIds([]);
                        }
                      }}
                    />
                  </TableHead>
                  <TableHead className="text-xs">שם</TableHead>
                  <TableHead className="text-xs">slug</TableHead>
                  <TableHead className="text-xs text-center">סטטוס</TableHead>
                  <TableHead className="text-xs text-center">נכסים</TableHead>
                  <TableHead className="text-xs w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedVisibleTags.map(tag => (
                  <TableRow key={tag.id} className={`${!tag.is_active ? 'opacity-50' : ''}`}>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={selectedTagIds.includes(tag.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedTagIds(prev => [...prev, tag.id]);
                          } else {
                            setSelectedTagIds(prev => prev.filter(id => id !== tag.id));
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-sm">
                      {editingTagId === tag.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editingTagName}
                            onChange={(e) => setEditingTagName(e.target.value)}
                            className="h-8 text-xs max-w-[150px]"
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleUpdateTag(tag.id)}
                          />
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleUpdateTag(tag.id)}>
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setEditingTagId(null)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <span>{tag.name}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground"><span dir="ltr">{tag.slug}</span></TableCell>
                    <TableCell className="text-center">
                      <Badge variant={tag.is_active ? 'default' : 'secondary'} className="text-[10px]">
                        {tag.is_active ? 'פעיל' : 'ארכיון'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-sm">{tag.asset_count}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {editingTagId !== tag.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name); }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {tag.is_active ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => handleArchiveTag(tag)} title="ארכב">
                            <Archive className="w-3.5 h-3.5" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => handleRestoreTag(tag)} title="הפעל מחדש">
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="מחיקה לצמיתות">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent dir="rtl">
                            <AlertDialogHeader>
                              <AlertDialogTitle>למחוק את התגית?</AlertDialogTitle>
                              <AlertDialogDescription>
                                התגית "{tag.name}" תימחק לצמיתות מהמערכת.
                                {tag.asset_count > 0 && (
                                  <span className="block mt-2 font-bold text-destructive">
                                    לתשומת לבך: התגית משויכת ל־{tag.asset_count} נכסים. המחיקה תסיר את השיוך מכולם.
                                  </span>
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="flex-row gap-2 justify-end sm:justify-end">
                              <AlertDialogCancel className="mt-0">ביטול</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteTag(tag.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                מחיקה לצמיתות
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden flex flex-col gap-3">
            {sortedVisibleTags.map(tag => (
              <div key={tag.id} className={`p-4 rounded-md border flex flex-col gap-2 ${!tag.is_active ? 'opacity-50' : ''}`}>
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedTagIds.includes(tag.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedTagIds(prev => [...prev, tag.id]);
                        } else {
                          setSelectedTagIds(prev => prev.filter(id => id !== tag.id));
                        }
                      }}
                    />
                    {editingTagId === tag.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editingTagName}
                          onChange={(e) => setEditingTagName(e.target.value)}
                          className="h-8 text-xs max-w-[150px]"
                          autoFocus
                          onKeyDown={(e) => e.key === 'Enter' && handleUpdateTag(tag.id)}
                        />
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleUpdateTag(tag.id)}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setEditingTagId(null)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="font-medium text-sm">{tag.name}</span>
                    )}
                  </div>
                  <Badge variant={tag.is_active ? 'default' : 'secondary'} className="text-[10px]">
                    {tag.is_active ? 'פעיל' : 'ארכיון'}
                  </Badge>
                </div>
                
                <div className="flex justify-between items-center text-xs text-muted-foreground mt-1">
                  <div className="flex flex-col gap-1">
                    <div>slug: <span dir="ltr">{tag.slug}</span></div>
                    <div>נכסים: {tag.asset_count}</div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t">
                  {editingTagId !== tag.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-primary"
                      onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name); }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {tag.is_active ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => handleArchiveTag(tag)} title="ארכב">
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => handleRestoreTag(tag)} title="הפעל מחדש">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="מחיקה לצמיתות">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent dir="rtl">
                      <AlertDialogHeader>
                        <AlertDialogTitle>למחוק את התגית?</AlertDialogTitle>
                        <AlertDialogDescription>
                          התגית "{tag.name}" תימחק לצמיתות מהמערכת.
                          {tag.asset_count > 0 && (
                            <span className="block mt-2 font-bold text-destructive">
                              לתשומת לבך: התגית משויכת ל־{tag.asset_count} נכסים. המחיקה תסיר את השיוך מכולם.
                            </span>
                          )}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter className="flex-row gap-2 justify-end sm:justify-end">
                        <AlertDialogCancel className="mt-0">ביטול</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeleteTag(tag.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          מחיקה לצמיתות
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
