import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { useG } from '@/lib/gender';
import CreateFormatDialog from '@/components/CreateFormatDialog';

interface Props {
  open: boolean;
  onClose: () => void;
  channels: { id: string; name: string }[];
  value: string | null;
  onConfirm: (id: string) => void;
  onCreateNew?: () => void; // Deprecated, kept for backward compatibility if needed
}

export default function FormatPickerDialog({ open, onClose, channels, value, onConfirm, onCreateNew }: Props) {
  const g = useG();
  const [selected, setSelected] = useState<string | null>(value);
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [extraChannels, setExtraChannels] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (open) {
      setSelected(value);
      setQuery('');
      setExtraChannels([]);
      setShowCreate(false);
    }
  }, [open, value]);

  const displayChannels = [...channels, ...extraChannels];
  const isCreationHandledInternally = !onCreateNew;

  const filteredChannels = query.trim() === ''
    ? displayChannels
    : displayChannels.filter(ch => ch.name.toLowerCase().includes(query.trim().toLowerCase()));

  const showCreateOption = query.trim().length > 0 && !displayChannels.some(ch => ch.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent dir="rtl" className="max-w-md z-[60]">
          <DialogHeader>
            <DialogTitle className="text-right">בחירת פורמט</DialogTitle>
          </DialogHeader>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (onCreateNew) {
                onCreateNew();
              } else {
                setShowCreate(true);
              }
            }}
            className="self-start"
          >
            <Plus className="h-4 w-4 ms-1" />
            פורמט חדש
          </Button>
          <Command shouldFilter={false} className="rounded-md border">
            <CommandInput
              placeholder={g("חפש פורמט...")}
              value={query}
              onValueChange={setQuery}
              dir="rtl"
            />
            <CommandList className="max-h-[320px] overflow-y-auto overscroll-contain">
              {filteredChannels.length === 0 && !showCreateOption && (
                <div className="py-6 text-center text-sm text-muted-foreground" role="presentation">לא נמצאו פורמטים</div>
              )}
              {filteredChannels.length > 0 && (
                <CommandGroup>
                  {filteredChannels.map((ch) => (
                    <CommandItem
                      key={ch.id}
                      value={ch.id}
                      onSelect={() => setSelected(ch.id)}
                      className="flex items-center justify-between gap-2 cursor-pointer transition-colors"
                    >
                      <span>{ch.name}</span>
                      {selected === ch.id && <Check className="h-4 w-4 text-primary" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {showCreateOption && (
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      if (onCreateNew) {
                        onCreateNew();
                      } else {
                        setShowCreate(true);
                      }
                    }}
                    className="text-sm text-primary font-medium bg-primary/5 hover:bg-primary/10 transition-colors animate-in fade-in slide-in-from-top-1 duration-200 cursor-pointer"
                  >
                    <Plus className="w-4 h-4 ms-2 flex-shrink-0" />
                    צור פורמט חדש: "{query.trim()}"
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
          <DialogFooter className="flex-row gap-2">
            <Button
              type="button"
              onClick={() => { if (selected) { onConfirm(selected); onClose(); } }}
              disabled={!selected}
            >
              אישור
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {isCreationHandledInternally && (
        <CreateFormatDialog
          open={showCreate}
          defaultName={query.trim()}
          onClose={() => setShowCreate(false)}
          onCreated={(info) => {
            const sizeLabel = info.size.width_only
              ? (info.size.max_width ? `${info.size.width}-${info.size.max_width}×auto` : `${info.size.width}×auto`)
              : `${info.size.width}×${info.size.height}`;
            // Provide a composed ID that is likely compatible with most usages
            const composedId = `${info.channelId}_${sizeLabel}`;
            
            setExtraChannels((prev) => [
              ...prev,
              { id: composedId, name: `${info.channelName} (${sizeLabel})` }
            ]);
            setSelected(composedId);
            setShowCreate(false);
          }}
        />
      )}
    </>
  );
}