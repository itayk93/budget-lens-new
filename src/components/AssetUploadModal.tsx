import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Upload, X, AlertTriangle, Check, Plus, Sparkles, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { splitPdfToImages } from '@/lib/pdfSplit';
import { filesFromDropItems } from '@/lib/dropEntries';
import FormatPickerDialog from '@/components/FormatPickerDialog';
import CreateFormatDialog from '@/components/CreateFormatDialog';
import { selectAll } from '@/lib/supabaseFetch';
import { useG } from '@/lib/gender';

interface Props {
  campaignId: string;
  campaignChannels: { id: string; name: string }[];
  onClose: () => void;
  onUploaded: () => void;
  initialFiles?: File[];
}

interface TagOption {
  id: string;
  name: string;
  parent_id?: string | null;
}

interface FileInfo {
  file: File;
  width: number;
  height: number;
  hash: string;
  matchedChannels: { id: string; originalId?: string; name: string; size: string }[];
  assignedChannel: string | null;
  suggestedChannel?: { id: string; originalId?: string; name: string; size: string } | null;
  closestRecommendations: { id: string; originalId?: string; name: string; size: string; similarity: number }[];
  displayName: string;
  selectedTags: string[];
  status: 'pending' | 'uploading' | 'done' | 'error' | 'duplicate';
  error?: string;
}

type RejectionType = 'duplicate' | 'oversized' | 'upload_error';
interface RejectedFile {
  name: string;
  path: string;
  reason: string;
  type: RejectionType;
}

async function computeHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (file.type.startsWith('image/')) {
      const img = new Image();
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(img.src); };
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = URL.createObjectURL(file);
    } else if (file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.onloadedmetadata = () => { resolve({ width: video.videoWidth, height: video.videoHeight }); URL.revokeObjectURL(video.src); };
      video.onerror = () => resolve({ width: 0, height: 0 });
      video.src = URL.createObjectURL(file);
    } else {
      resolve({ width: 0, height: 0 });
    }
  });
}

function getSimilarity(w1: number, h1: number, w2: number, h2: number): number {
  if (w1 === 0 || h1 === 0 || w2 === 0 || h2 === 0) return 0;
  const ratio1 = w1 / h1;
  const ratio2 = w2 / h2;
  const ratioSimilarity = 1 - Math.min(Math.abs(ratio1 - ratio2) / Math.max(ratio1, ratio2), 1);
  const areaSimilarity = 1 - Math.min(Math.abs(w1 * h1 - w2 * h2) / Math.max(w1 * h1, w2 * h2), 1);
  return (ratioSimilarity * 0.8) + (areaSimilarity * 0.2);
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export default function AssetUploadModal({ campaignId, campaignChannels, onClose, onUploaded, initialFiles }: Props) {
  const g = useG();
  const { user } = useAuth();
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; current: number; total: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [channelSizes, setChannelSizes] = useState<any[]>([]);
  const [addedChannels, setAddedChannels] = useState<{ id: string; name: string }[]>([]);
  const [systemSettings, setSystemSettings] = useState<Record<string, any>>({});
  const [availableTags, setAvailableTags] = useState<TagOption[]>([]);
  const [allChannels, setAllChannels] = useState<{ id: string; name: string }[]>([]);
  const [dropzoneOpen, setDropzoneOpen] = useState(false);
  const [formatPickerIndex, setFormatPickerIndex] = useState<number | null>(null);
  const [createFormatForIndex, setCreateFormatForIndex] = useState<number | null>(null);
  const [unassignedWarningOpen, setUnassignedWarningOpen] = useState(false);
  const [unassignedTagsWarningOpen, setUnassignedTagsWarningOpen] = useState(false);
  const [pendingUploadData, setPendingUploadData] = useState<FileInfo[] | null>(null);
  const [rejectedFiles, setRejectedFiles] = useState<RejectedFile[]>([]);
  const [maxSizeMbDisplay, setMaxSizeMbDisplay] = useState<number>(50);
  const [uploadSummary, setUploadSummary] = useState<{ success: number; failed: number; failures: RejectedFile[] } | null>(null);
  const [lastBatchStats, setLastBatchStats] = useState<{ total: number; ready: number; rejected: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
      folderInputRef.current.setAttribute('mozdirectory', '');
    }
  }, []);

  // Load system settings and tags on mount
  useEffect(() => {
    selectAll<any>((from, to) => supabase.from('system_settings').select('key, value').range(from, to)).then((data) => {
      const mapped: Record<string, any> = {};
      data.forEach((s: any) => { mapped[s.key] = s.value; });
      setSystemSettings(mapped);
    });
    selectAll<any>((from, to) => supabase.from('tags').select('id, name, parent_id').eq('is_active', true).order('name').range(from, to)).then((data) => {
      setAvailableTags(data);
    });
    selectAll<any>((from, to) => supabase.from('media_channels').select('id, name').order('name').range(from, to)).then((data) => {
      setAllChannels(data);
    });
  }, []);

  const loadChannelSizes = async () => {
    return await selectAll<any>((from, to) => supabase.from('channel_sizes').select('*, media_channels(id, name)').range(from, to));
  };

  // Extract folder-tag names from a file's webkitRelativePath.
  // Every folder segment in the path becomes a tag (including the root the
  // user chose). Only the filename itself is dropped.
  const folderTagsFromFile = (file: File): string[] => {
    const rel = (file as any).webkitRelativePath as string | undefined;
    if (!rel || !rel.includes('/')) return [];
    const parts = rel.split('/').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return [];
    return parts.slice(0, -1);
  };

  // Ensure tags exist preserving folder hierarchy:
  // folder paths like ["מסעות לקוח", "מסע פירעון אשראי"] create
  // "מסעות לקוח" as a root tag and "מסע פירעון אשראי" as its child.
  // Returns map: "parent/child/..." path key -> tag id (one per segment).
  const ensureFolderTagHierarchy = async (
    paths: string[][]
  ): Promise<Map<string, string>> => {
    const pathKey = (segs: string[]) => segs.join('\u0001');
    const result = new Map<string, string>();
    if (paths.length === 0) return result;

    // Collect all unique prefixes (each folder segment along its path)
    const allPrefixes = new Set<string>();
    paths.forEach((segs) => {
      for (let i = 1; i <= segs.length; i++) {
        allPrefixes.add(pathKey(segs.slice(0, i)));
      }
    });

    // Refresh tags from DB so we have an up-to-date view including parent_id
    const { data: dbTags } = await supabase
      .from('tags')
      .select('id, name, parent_id')
      .eq('is_active', true);
    const byId = new Map<string, { id: string; name: string; parent_id: string | null }>();
    (dbTags || []).forEach((t: any) => byId.set(t.id, t));

    const findTag = (name: string, parentId: string | null) => {
      const lower = name.toLowerCase();
      for (const t of byId.values()) {
        if (t.name.toLowerCase() === lower && (t.parent_id || null) === parentId) return t;
      }
      return null;
    };

    // Sort prefixes by depth so parents are created before children
    const sortedPrefixes = Array.from(allPrefixes)
      .map((k) => k.split('\u0001'))
      .sort((a, b) => a.length - b.length);

    for (const segs of sortedPrefixes) {
      const name = segs[segs.length - 1];
      const parentKey = segs.length > 1 ? pathKey(segs.slice(0, -1)) : null;
      const parentId = parentKey ? result.get(parentKey) || null : null;

      let tag = findTag(name, parentId);
      if (!tag) {
        const insertPayload: any = { name };
        if (parentId) insertPayload.parent_id = parentId;
        const { data: inserted, error } = await supabase
          .from('tags')
          .insert(insertPayload)
          .select('id, name, parent_id')
          .single();
        if (inserted) {
          tag = inserted as any;
          byId.set(tag.id, tag as any);
        } else if (error) {
          // Conflict — refetch and try to find the existing one
          const { data: refetched } = await supabase
            .from('tags')
            .select('id, name, parent_id')
            .eq('name', name);
          (refetched || []).forEach((t: any) => byId.set(t.id, t));
          tag = findTag(name, parentId);
          if (!tag && refetched && refetched.length > 0) {
            // Fallback: take any tag by that name
            tag = refetched[0] as any;
          }
        }
      }
      if (tag) result.set(pathKey(segs), tag.id);
    }

    // Refresh local availableTags cache
    setAvailableTags(
      Array.from(byId.values()).map((t) => ({ id: t.id, name: t.name, parent_id: t.parent_id }))
    );

    return result;
  };

  const processFiles = async (rawSelected: File[]) => {
    // Reset the input so re-selecting the same folder triggers change again
    if (rawSelected.length === 0) return;

    // Filter out hidden / OS-junk files (e.g. .DS_Store, Thumbs.db, ._*)
    rawSelected = rawSelected.filter((f) => {
      const name = f.name;
      if (!name) return false;
      if (name.startsWith('.')) return false; // .DS_Store, .gitignore, etc.
      if (name.startsWith('._')) return false; // macOS resource forks
      if (/^(Thumbs\.db|desktop\.ini)$/i.test(name)) return false;
      return true;
    });
    if (rawSelected.length === 0) {
      toast.info('לא נמצאו קבצים להעלאה (קבצים נסתרים סוננו)');
      return;
    }

    if (rawSelected.length > 100) {
      toast.error(g(`נבחרו ${rawSelected.length} קבצים — מגבלת ההעלאה היא 100 קבצים בבת אחת. אנא בחר עד 100 קבצים והעלה שוב.`));
      return;
    }

    // Show progress UI immediately — PDF splitting can be the longest phase
    setProcessing(true);
    setProgress({ phase: 'מכין קבצים', current: 0, total: rawSelected.length });

    // Step 1: pre-resolve folder tags for the whole batch (one DB roundtrip),
    // preserving folder hierarchy (parent folder -> parent tag, sub-folder -> child tag).
    const allPaths: string[][] = rawSelected
      .map((f) => folderTagsFromFile(f))
      .filter((p) => p.length > 0);
    const pathTagMap = allPaths.length > 0
      ? await ensureFolderTagHierarchy(allPaths)
      : new Map<string, string>();
    const pathKey = (segs: string[]) => segs.join('\u0001');

    // Step 2: expand PDFs into per-page images. Each expanded file inherits the
    // folder tags of its source PDF, and we carry the source's folder path
    // for clearer error messages later.
    const expanded: { file: File; folderTagIds: string[]; sourcePath: string; pageInfo?: string; precomputedHash?: string }[] = [];
    const pdfFiles = rawSelected.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    setProgress({ phase: pdfFiles.length > 0 ? 'מפצל קבצי PDF במקביל' : 'מעבד קבצים', current: 0, total: rawSelected.length });
    let processedSources = 0;

    // Process source files in parallel (concurrency = 3 to avoid memory blowup on large PDFs)
    const SPLIT_CONCURRENCY = 3;
    const queue = rawSelected.map((f, idx) => ({ f, idx }));
    const results: { idx: number; items: { file: File; folderTagIds: string[]; sourcePath: string; pageInfo?: string; precomputedHash?: string }[] }[] = [];

    const worker = async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        const { f, idx } = next;
        const folderNames = folderTagsFromFile(f);
        // For each prefix along the folder path, look up the corresponding tag id
        const folderTagIds: string[] = [];
        for (let i = 1; i <= folderNames.length; i++) {
          const id = pathTagMap.get(pathKey(folderNames.slice(0, i)));
          if (id) folderTagIds.push(id);
        }
        const sourcePath = (f as any).webkitRelativePath || f.name;
        const items: { file: File; folderTagIds: string[]; sourcePath: string; pageInfo?: string; precomputedHash?: string }[] = [];
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          try {
            const pages = await splitPdfToImages(f);
            if (pages.length === 0) items.push({ file: f, folderTagIds, sourcePath });
            else pages.forEach((p, pageIdx) => items.push({ file: p.file, folderTagIds, sourcePath, pageInfo: `עמוד ${pageIdx + 1}`, precomputedHash: p.hash }));
          } catch (err) {
            console.error('PDF split failed', err);
            toast.error(`כשל בפיצול ה-PDF: ${f.name}`);
            items.push({ file: f, folderTagIds, sourcePath });
          }
        } else {
          items.push({ file: f, folderTagIds, sourcePath });
        }
        results.push({ idx, items });
        processedSources++;
        setProgress({
          phase: pdfFiles.length > 0 ? `מפצל קבצי PDF (${SPLIT_CONCURRENCY} במקביל)` : 'מעבד קבצים',
          current: processedSources,
          total: rawSelected.length,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(SPLIT_CONCURRENCY, rawSelected.length) }, () => worker()));
    results.sort((a, b) => a.idx - b.idx);
    results.forEach((r) => r.items.forEach((it) => expanded.push(it)));

    const selected = expanded.map((x) => x.file);
    const folderTagsByIndex = expanded.map((x) => x.folderTagIds);
    const sourcePathByIndex = expanded.map((x) => x.sourcePath);
    const pageInfoByIndex = expanded.map((x) => x.pageInfo);
    const precomputedHashByIndex = expanded.map((x) => x.precomputedHash);
    if (selected.length === 0) { setProgress(null); setProcessing(false); return; }

    const maxSizeMb = parseInt(systemSettings.max_file_size_mb) || 50;
    setMaxSizeMbDisplay(maxSizeMb);
    const newRejections: RejectedFile[] = [];
    const allowed: File[] = [];
    const allowedFolderTags: string[][] = [];
    const allowedSourcePaths: string[] = [];
    const allowedPrecomputedHashes: (string | undefined)[] = [];
    selected.forEach((f, idx) => {
      if (f.size > maxSizeMb * 1048576) {
        const sizeMb = Math.round(f.size / 1048576);
        const page = pageInfoByIndex[idx];
        newRejections.push({
          name: f.name,
          path: sourcePathByIndex[idx] + (page ? ` (${page})` : ''),
          reason: `חורג מהגודל המקסימלי (${sizeMb}MB מתוך ${maxSizeMb}MB)`,
          type: 'oversized',
        });
        return;
      }
      allowed.push(f);
      allowedFolderTags.push(folderTagsByIndex[idx]);
      allowedSourcePaths.push(sourcePathByIndex[idx] + (pageInfoByIndex[idx] ? ` (${pageInfoByIndex[idx]})` : ''));
      allowedPrecomputedHashes.push(precomputedHashByIndex[idx]);
    });
    if (newRejections.some((r) => r.type === 'oversized')) {
      toast.error(`${newRejections.filter((r) => r.type === 'oversized').length} קבצים חורגים מהגודל המקסימלי (${maxSizeMb}MB) ולא יועלו`);
    }
    if (allowed.length === 0 && newRejections.length === 0) {
      setProgress(null);
      setProcessing(false);
      return;
    }
    // Replace selected/folder arrays with allowed-only
    selected.length = 0;
    selected.push(...allowed);
    folderTagsByIndex.length = 0;
    folderTagsByIndex.push(...allowedFolderTags);
    sourcePathByIndex.length = 0;
    sourcePathByIndex.push(...allowedSourcePaths);
    precomputedHashByIndex.length = 0;
    precomputedHashByIndex.push(...allowedPrecomputedHashes);
    if (selected.length === 0) {
      // Everything was rejected — commit rejection list and bail
      setRejectedFiles((prev) => [...prev, ...newRejections]);
      setLastBatchStats({ total: expanded.length, ready: 0, rejected: newRejections.length });
      setProgress(null);
      setProcessing(false);
      return;
    }

    // הוסרה מגבלת מספר הנכסים לקמפיין לפי בקשת המשתמש

    const sizes = channelSizes.length > 0 ? channelSizes : await loadChannelSizes();
    if (channelSizes.length === 0) setChannelSizes(sizes);

    const existingAssets = await selectAll<any>((from, to) =>
      supabase.from('assets').select('file_hash, file_name').eq('campaign_id', campaignId).range(from, to)
    );
    const existingHashes = new Set(existingAssets.map((a: any) => a.file_hash));
    const existingNames = new Set(existingAssets.map((a: any) => a.file_name));

    const newFiles: FileInfo[] = [];
    const allAvailableChannels = [...campaignChannels, ...addedChannels];

    setProgress({ phase: 'מחשב חתימות ומידות', current: 0, total: selected.length });
    // Compute hash + dims for every file in parallel (concurrency = 6)
    const ANALYZE_CONCURRENCY = 6;
    type Analyzed = { idx: number; hash: string; dims: { width: number; height: number } };
    const analyzed: Analyzed[] = new Array(selected.length);
    let analyzedCount = 0;
    const aQueue = selected.map((_, i) => i);
    const aWorker = async () => {
      while (aQueue.length > 0) {
        const i = aQueue.shift();
        if (i === undefined) break;
        const file = selected[i];
        const pre = precomputedHashByIndex[i];
        const [hash, dims] = await Promise.all([
          pre ? Promise.resolve(pre) : computeHash(file),
          getImageDimensions(file),
        ]);
        analyzed[i] = { idx: i, hash, dims };
        analyzedCount++;
        setProgress({ phase: 'מחשב חתימות ומידות', current: analyzedCount, total: selected.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(ANALYZE_CONCURRENCY, selected.length) }, () => aWorker()));

    for (let idx = 0; idx < selected.length; idx++) {
      const file = selected[idx];
      const folderTagIds = folderTagsByIndex[idx] || [];
      const { hash, dims } = analyzed[idx];

      if (existingHashes.has(hash)) {
        newRejections.push({
          name: file.name,
          path: sourcePathByIndex[idx] || file.name,
          reason: 'כבר קיים בקמפיין הזה (תוכן זהה)',
          type: 'duplicate',
        });
        continue;
      }

      const matched = sizes
        .filter((s: any) => {
          if (s.width_only) {
            const minW = s.width;
            const maxW = s.max_width || s.width;
            return dims.width >= minW && dims.width <= maxW;
          }
          return s.width === dims.width && s.height === dims.height;
        })
        .map((s: any) => {
          const ch = s.media_channels || campaignChannels.find((c) => c.id === s.channel_id);
          const sizeLabel = s.width_only
            ? (s.max_width ? `${s.width}-${s.max_width}×auto` : `${s.width}×auto`)
            : `${s.width}×${s.height}`;
          return ch ? { id: `${ch.id}_${sizeLabel}`, originalId: ch.id, name: ch.name, size: `${sizeLabel} - ${s.description || ''}` } : null;
        })
        .filter(Boolean) as { id: string; originalId: string; name: string; size: string }[];

      const uniqueMatched = matched.filter((m, i, arr) => arr.findIndex((a) => a.id === m.id) === i);

      let assignedChannel: string | null = null;
      let suggestedChannel: { id: string; originalId?: string; name: string; size: string } | null = null;
      let closestRecommendations: { id: string; originalId?: string; name: string; size: string; similarity: number }[] = [];

      const campaignMatch = uniqueMatched.find(m => allAvailableChannels.some(c => c.id === m.originalId));
      if (campaignMatch) {
        assignedChannel = campaignMatch.id;
        suggestedChannel = campaignMatch;
      } else if (uniqueMatched.length > 0) {
        assignedChannel = uniqueMatched[0].id;
        suggestedChannel = uniqueMatched[0];
      } else {
        closestRecommendations = sizes
          .map((s: any) => {
            const ch = s.media_channels || campaignChannels.find((c) => c.id === s.channel_id);
            if (!ch) return null;
            let similarity: number;
            if (s.width_only) {
              const minW = s.width;
              const maxW = s.max_width || s.width;
              const mid = (minW + maxW) / 2;
              similarity = 1 - Math.min(Math.abs(dims.width - mid) / Math.max(mid, dims.width), 1);
            } else {
              similarity = getSimilarity(dims.width, dims.height, s.width, s.height);
            }
            const sizeLabel = s.width_only
              ? (s.max_width ? `${s.width}-${s.max_width}×auto` : `${s.width}×auto`)
              : `${s.width}×${s.height}`;
            return { id: `${ch.id}_${sizeLabel}`, originalId: ch.id, name: ch.name, size: `${sizeLabel} - ${s.description || ''}`, similarity };
          })
          .filter(Boolean)
          .filter((rec: any) => rec.similarity > 0.6)
          .sort((a: any, b: any) => b.similarity - a.similarity)
          .filter((rec: any, idx: number, self: any[]) => idx === self.findIndex((r) => r.id === rec.id))
          .slice(0, 3);
      }

      let fileName = file.name;
      if (existingNames.has(fileName)) {
        const ext = fileName.substring(fileName.lastIndexOf('.'));
        const base = fileName.substring(0, fileName.lastIndexOf('.'));
        let counter = 2;
        while (existingNames.has(`${base}(${counter})${ext}`)) counter++;
        fileName = `${base}(${counter})${ext}`;
        toast.info(`קובץ בשם זה כבר קיים בקמפיין. הקובץ יישמר בשם: ${fileName}`);
      }

      existingNames.add(fileName);
      existingHashes.add(hash);

      newFiles.push({
        file: new File([file], fileName, { type: file.type }),
        width: dims.width, height: dims.height, hash,
        matchedChannels: uniqueMatched,
        assignedChannel,
        suggestedChannel,
        closestRecommendations,
        selectedTags: folderTagIds,
        displayName: fileName.substring(0, fileName.lastIndexOf('.')) || fileName,
        status: 'pending',
      });
    }

    if (newRejections.length > 0) {
      setRejectedFiles((prev) => [...prev, ...newRejections]);
    }
    setLastBatchStats({ total: expanded.length, ready: newFiles.length, rejected: newRejections.length });
    setFiles((prev) => [...prev, ...newFiles]);
    setProcessing(false);
    setProgress(null);
    setDropzoneOpen(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawSelected = Array.from(e.target.files || []);
    if (e.target) e.target.value = '';
    await processFiles(rawSelected);
  };

  // Process files passed in from a page-level drop
  const initialHandled = useRef(false);
  useEffect(() => {
    if (initialHandled.current) return;
    if (initialFiles && initialFiles.length > 0) {
      initialHandled.current = true;
      processFiles(initialFiles);
    }
  }, [initialFiles]);

  const handleUpload = () => {
    const toUpload = files.filter((f) => f.status === 'pending');
    if (toUpload.length === 0) {
      toast.error('אין קבצים להעלאה');
      return;
    }

    // Validate mandatory fields (only title is required; format and tags are optional)
    const invalid = toUpload.filter(f => !f.displayName.trim());
    if (invalid.length > 0) {
      toast.error('חובה למלא כותרת לכל קובץ');
      return;
    }

    setPendingUploadData(toUpload);
    checkWarningsAndUpload(toUpload);
  };

  const checkWarningsAndUpload = (toUpload: FileInfo[]) => {
    const missingFormat = toUpload.filter(f => !f.assignedChannel);
    if (missingFormat.length > 0) {
      setUnassignedWarningOpen(true);
      return;
    }
    const missingTags = toUpload.filter(f => f.selectedTags.length === 0);
    if (missingTags.length > 0) {
      setUnassignedTagsWarningOpen(true);
      return;
    }
    executeUpload(toUpload);
  };

  const executeUpload = async (toUpload: FileInfo[]) => {
    setUnassignedWarningOpen(false);
    setUploading(true);
    setUploadSummary(null);
    setUploadProgress({ current: 0, total: toUpload.length });
    let uploadedProcessed = 0;

    const uploadOne = async (fileInfo: FileInfo) => {
      fileInfo.status = 'uploading';
      setFiles([...files]);

      const assignedChannelObj = mergedChannels.find(c => c.id === fileInfo.assignedChannel);
      let channelId = assignedChannelObj ? (assignedChannelObj as any).originalId : (fileInfo.assignedChannel || null);
      if (channelId && channelId.includes('_')) {
        channelId = channelId.split('_')[0];
      }
      const sanitizedName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${fileInfo.file.name.split('.').pop()}`;
      const path = `${campaignId}/${channelId || 'unassigned'}/${sanitizedName}`;

      const { error: storageError } = await supabase.storage
        .from('campaign-assets')
        .upload(path, fileInfo.file, { upsert: false });

      if (storageError) {
        fileInfo.status = 'error';
        fileInfo.error = storageError.message;
        uploadedProcessed += 1;
        setUploadProgress({ current: uploadedProcessed, total: toUpload.length });
        setFiles([...files]);
        return;
      }

      const { data: insertedAsset, error: dbError } = await supabase.from('assets').insert({
        campaign_id: campaignId,
        channel_id: channelId,
        file_name: sanitizedName,
        original_file_name: fileInfo.displayName,
        title: fileInfo.displayName,
        file_path: path,
        file_hash: fileInfo.hash,
        file_type: fileInfo.file.type,
        width: fileInfo.width || null,
        height: fileInfo.height || null,
        file_size: fileInfo.file.size,
        uploaded_by: user?.id,
      }).select('id').single();

      if (dbError) {
        fileInfo.status = 'error';
        fileInfo.error = dbError.message;
      } else {
        if (insertedAsset?.id) {
          // Junction table
          await supabase.from('asset_campaigns').insert({
            asset_id: insertedAsset.id,
            campaign_id: campaignId,
          } as any);
          // Tags
          if (fileInfo.selectedTags.length > 0) {
            await supabase.from('asset_tags').insert(
              fileInfo.selectedTags.map(tagId => ({
                asset_id: insertedAsset.id,
                tag_id: tagId,
              })) as any
            );
          }
        }
        fileInfo.status = 'done';
        await supabase.from('audit_logs').insert({
          user_id: user?.id,
          action_type: 'upload',
          entity_type: 'asset',
          entity_id: campaignId,
          metadata: { file_name: fileInfo.file.name, channel_id: channelId || 'unassigned' },
        });
      }
      uploadedProcessed += 1;
      setUploadProgress({ current: uploadedProcessed, total: toUpload.length });
      setFiles([...files]);
    };

    // Upload up to 3 files in parallel
    const UPLOAD_CONCURRENCY = 3;
    const upQueue = [...toUpload];
    const upWorker = async () => {
      while (upQueue.length > 0) {
        const fi = upQueue.shift();
        if (!fi) break;
        await uploadOne(fi);
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, toUpload.length) }, () => upWorker()));

    setUploading(false);
    setUploadProgress(null);
    const success = toUpload.filter((f) => f.status === 'done').length;
    const failures: RejectedFile[] = toUpload
      .filter((f) => f.status === 'error')
      .map((f) => ({
        name: f.file.name,
        path: f.file.name,
        reason: f.error || 'שגיאת העלאה לא ידועה',
        type: 'upload_error' as const,
      }));
    if (failures.length > 0) {
      setRejectedFiles((prev) => [...prev, ...failures]);
    }
    setUploadSummary({ success, failed: failures.length, failures });
    if (failures.length === 0) {
      toast.success(`ההעלאה הושלמה — ${success} קבצים עלו בהצלחה`);
    } else {
      toast.error(`הסתיים: ${success} הצליחו, ${failures.length} נכשלו`);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const addChannelToCampaign = async (fileIndex: number, channel: { id: string; name: string; originalId?: string }) => {
    try {
      const actualChannelId = channel.originalId || channel.id;
      // Check if already linked before inserting to avoid duplicate key error
      const { data: existing } = await supabase
        .from('campaign_channels')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('channel_id', actualChannelId)
        .maybeSingle();

      if (!existing) {
        const { error } = await supabase.from('campaign_channels').insert({
          campaign_id: campaignId,
          channel_id: actualChannelId,
        });
        if (error) throw error;
      }

      if (!addedChannels.some(c => c.id === actualChannelId)) {
        setAddedChannels(prev => [...prev, { id: actualChannelId, name: channel.name.split(' (')[0] }]);
      }

      const updatedFiles = [...files];
      updatedFiles[fileIndex].assignedChannel = channel.id;
      updatedFiles[fileIndex].suggestedChannel = null;
      updatedFiles[fileIndex].closestRecommendations = [];
      setFiles(updatedFiles);

      toast.success(`הפורמט ${channel.name} נוסף להעלאה`);
    } catch (e: any) {
      toast.error(`שגיאה בהוספת פורמט: ${e.message}`);
    }
  };

  const toggleTag = (fileIndex: number, tagId: string) => {
    const updated = [...files];
    const current = updated[fileIndex].selectedTags;
    if (current.includes(tagId)) {
      updated[fileIndex].selectedTags = current.filter(t => t !== tagId);
    } else {
      updated[fileIndex].selectedTags = [...current, tagId];
    }
    setFiles(updated);
  };

  const mergeSuggestedTags = (fileIndex: number, tagIds: string[]) => {
    if (tagIds.length === 0) return;
    const updated = [...files];
    const current = updated[fileIndex].selectedTags;
    updated[fileIndex].selectedTags = Array.from(new Set([...current, ...tagIds]));
    setFiles(updated);
  };

  const handleAddTag = async (name: string): Promise<string | null> => {
    const baseSlug = name.toLowerCase().replace(/\s+/g, '-');
    const slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
    
    const { data, error } = await supabase.from('tags').insert({ name, slug } as any).select('id, name').single();
    if (error) {
      toast.error('שגיאה ביצירת תגית: ' + error.message);
      return null;
    }
    setAvailableTags(prev => [...prev, { id: (data as any).id, name: (data as any).name }]);
    return (data as any).id;
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const completedCount = files.filter((f) => f.status === 'done').length;
  const issuesCount = files.filter((f) => f.status === 'error' || f.status === 'duplicate').length;
  const uploadFinished = files.length > 0 && pendingCount === 0 && completedCount > 0 && !uploading && !processing;
  const allAvailableChannels = [...campaignChannels, ...addedChannels];
  // Merge with allChannels for format dropdown (show all, not just campaign ones)
  const allChannelsMerged = [...allAvailableChannels];
  allChannels.forEach(ch => {
    if (!allChannelsMerged.some(c => c.id === ch.id)) allChannelsMerged.push(ch);
  });

  const channelSizesMap = new Map<string, any[]>();
  channelSizes.forEach((cs) => {
    if (!channelSizesMap.has(cs.channel_id)) {
      channelSizesMap.set(cs.channel_id, []);
    }
    channelSizesMap.get(cs.channel_id)?.push(cs);
  });

  const mergedChannels = allChannelsMerged.flatMap(ch => {
    const sizes = channelSizesMap.get(ch.id) || [];
    if (sizes.length > 0) {
      return sizes.map((s) => {
        const sizeLabel = s.width_only
          ? (s.max_width ? `${s.width}-${s.max_width}×auto` : `${s.width}×auto`)
          : `${s.width}×${s.height}`;
        return {
          ...ch,
          id: `${ch.id}_${sizeLabel}`,
          originalId: ch.id,
          name: `${ch.name} (${sizeLabel}${s.description ? ` - ${s.description}` : ''})`
        };
      });
    }
    return { ...ch, originalId: ch.id };
  });
  const openFilePicker = () => inputRef.current?.click();
  const openFolderPicker = () => folderInputRef.current?.click();
  const dropzoneVisible = files.length === 0 || dropzoneOpen;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        dir="rtl"
        className="left-[50%] top-[50%] mx-0 translate-x-[-50%] translate-y-[-50%] w-[calc(100vw-1.5rem)] sm:w-[min(96vw,1100px)] max-w-none h-[calc(100dvh-1.5rem)] sm:h-[min(90vh,860px)] max-h-none rounded-lg p-0 overflow-hidden text-start flex flex-col [&>button]:start-3 [&>button]:end-auto [&>button]:top-3 sm:[&>button]:start-4 sm:[&>button]:top-4"
      >
        <div className="flex h-full min-h-0 flex-col bg-background">
          <DialogHeader className="gap-2 border-b px-4 py-3 ps-12 sm:px-5 sm:py-4 sm:ps-14">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="text-xl font-bold sm:text-2xl">העלאת קבצים</DialogTitle>
              {files.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-xs">{files.length} קבצים</Badge>
                  {completedCount > 0 && <Badge className="text-xs bg-success/15 text-success hover:bg-success/15">{completedCount} הועלו</Badge>}
                  {issuesCount > 0 && <Badge variant="destructive" className="text-xs">{issuesCount} דורשים טיפול</Badge>}
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap">
              <p className="max-w-full text-sm text-muted-foreground whitespace-normal">
                השלם לכל קובץ כותרת, פורמט ותגיות לפני העלאה
              </p>
              <button
                type="button"
                onClick={() => setDropzoneOpen(true)}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&>svg]:pointer-events-none [&>svg]:size-4 [&>svg]:shrink-0 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md h-9 flex-shrink-0 px-4 text-sm w-full sm:w-auto"
              >
                העלה עוד קבצים
              </button>
            </div>
          </DialogHeader>

          {dropzoneVisible && (
            <div className="border-b px-4 py-3 sm:px-5 sm:py-4">
              <div
                className="rounded-xl border-2 border-dashed border-border bg-muted/20 px-6 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/30 cursor-pointer"
                onClick={openFilePicker}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const items = e.dataTransfer.items;
                  let dropped: File[] = [];
                  if (items && items.length > 0 && (items[0] as any).webkitGetAsEntry) {
                    dropped = await filesFromDropItems(items);
                  } else {
                    dropped = Array.from(e.dataTransfer.files);
                  }
                  if (dropped.length > 0) await processFiles(dropped);
                }}
              >
                <Upload className="mb-3 me-auto ms-auto h-11 w-11 text-muted-foreground" />
                <p className="text-lg font-semibold">{g(`לחץ לבחירת קבצים`)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{g(`או גרור לכאן קבצים`)}</p>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openFolderPicker(); }}
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                העלאת תיקיה שלמה
              </button>
              <p className="mt-1 text-[11px] text-muted-foreground">
                שמות תתי-התיקיות יוקצו אוטומטית כתגיות, ו-PDF יפוצל לעמודים
              </p>
              </div>
            </div>
          )}
          {processing && (
            <div className="border-b px-4 py-3 text-center text-sm text-muted-foreground sm:px-5 sm:py-4">
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="font-medium text-foreground">
                    {progress ? progress.phase : 'מעבד קבצים'}
                    {progress && progress.total > 0 && (
                      <span className="ms-2 text-muted-foreground" dir="ltr">
                        ({progress.current}/{progress.total})
                      </span>
                    )}
                  </span>
                </div>
                {progress && progress.total > 0 && (
                  <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          {uploading && (
            <div className="border-b border-primary/20 bg-primary/5 px-4 py-3 text-center text-sm text-muted-foreground sm:px-5 sm:py-4">
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="font-medium text-foreground">
                    מעלה קבצים עכשיו — נא להמתין
                    {uploadProgress && uploadProgress.total > 0 && (
                      <span className="ms-2 text-muted-foreground" dir="ltr">
                        ({uploadProgress.current}/{uploadProgress.total})
                      </span>
                    )}
                  </span>
                </div>
                {uploadProgress && uploadProgress.total > 0 && (
                  <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.max(4, Math.round((uploadProgress.current / uploadProgress.total) * 100))}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            accept="image/*,video/*,.pdf,.svg"
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          <div className="flex-1 min-h-0 overflow-hidden px-4 py-3 sm:px-5 sm:py-4">
            {(uploadSummary || uploadFinished) && (
              <div className={`mb-3 rounded-lg border p-3 text-sm ${rejectedFiles.length > 0 ? 'border-destructive/40 bg-destructive/5' : 'border-success/40 bg-success/5'}`}>
                <div className="flex items-center gap-2 font-semibold">
                  {rejectedFiles.length > 0 ? (
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  ) : (
                    <Check className="h-4 w-4 text-success" />
                  )}
                  <span>סיכום העלאה</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  ✅ {uploadSummary?.success ?? completedCount} קבצים הועלו בהצלחה
                  {rejectedFiles.length > 0 && <> · ❌ {rejectedFiles.length} לא עלו (פרטים מטה)</>}
                </p>
              </div>
            )}
            {!uploadSummary && lastBatchStats && lastBatchStats.rejected > 0 && (
              <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                <p className="font-medium">
                  נבחרו {lastBatchStats.total} קבצים: {lastBatchStats.ready} מוכנים להעלאה, {lastBatchStats.rejected} לא יעלו (ראה רשימה מטה).
                </p>
              </div>
            )}
            {files.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                אין קבצים להצגה עדיין
              </div>
            ) : (
              <div className="h-full min-h-0 grid grid-cols-1 lg:grid-cols-2 auto-rows-max gap-4 overflow-y-auto px-1 pb-2">
                {files.map((f, i) => {
                  const hasMissingName = !f.displayName.trim();
                  const hasMissingChannel = !f.assignedChannel;
                  const hasMissingTags = f.selectedTags.length === 0;
                  const isPendingInvalid = f.status === 'pending' && (hasMissingName || hasMissingChannel);

                  return (
                    <div
                      key={i}
                      className={`rounded-xl border p-4 transition-colors ${f.status === 'duplicate' ? 'border-destructive/35 bg-destructive/5' :
                        f.status === 'error' ? 'border-destructive/35 bg-destructive/5' :
                          f.status === 'done' ? 'border-success/35 bg-success/5' :
                            isPendingInvalid ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card'
                        }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="break-all text-sm font-medium leading-5" dir="ltr">{f.file.name}</p>
                        </div>
                        {f.status === 'pending' && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeFile(i)}>
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {f.status === 'pending' ? (
                        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                          <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">כותרת נכס (חובה)</Label>
                            <div className="flex gap-1.5">
                              <Input
                                value={f.displayName}
                                onChange={(e) => {
                                  const updated = [...files];
                                  updated[i].displayName = e.target.value;
                                  setFiles(updated);
                                }}
                                className={`h-9 text-sm flex-1 ${hasMissingName ? 'border-destructive' : ''}`}
                                placeholder="הכנס שם לנכס..."
                              />
                              <AiTitleButton
                                fileName={f.file.name}
                                fileType={f.file.type}
                                width={f.width}
                                height={f.height}
                                onSuggested={(title) => {
                                  const updated = [...files];
                                  updated[i].displayName = title;
                                  setFiles(updated);
                                }}
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">פורמט (חובה)</Label>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setFormatPickerIndex(i)}
                              className={`h-9 w-full justify-between text-xs font-normal ${hasMissingChannel ? 'border-destructive' : ''}`}
                            >
                              <span className={f.assignedChannel ? '' : 'text-muted-foreground'}>
                                {mergedChannels.find(c => c.id === f.assignedChannel)?.name || g('בחר פורמט...')}
                              </span>
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border bg-background px-3 py-2 text-sm font-medium" dir="ltr">
                          {f.displayName}
                        </div>
                      )}

                      {f.status === 'pending' && (
                        <div className="mt-3 space-y-1">
                          <Label className="text-[11px] text-muted-foreground">תגיות (אופציונלי)</Label>
                          <TagSelector
                            availableTags={availableTags}
                            selectedTags={f.selectedTags}
                            onToggle={(tagId) => toggleTag(i, tagId)}
                            onMergeSuggestedTags={(tagIds) => mergeSuggestedTags(i, tagIds)}
                            onAddTag={handleAddTag}
                            file={f.file}
                            fileName={f.file.name}
                            fileType={f.file.type}
                            width={f.width}
                            height={f.height}
                          />
                          {hasMissingTags && <p className="text-[11px] text-muted-foreground">ללא תגיות — הקובץ יסומן כ״לא מסווג״</p>}
                        </div>
                      )}

                      {f.error && (
                        <p className="mt-3 flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          {f.error}
                        </p>
                      )}
                      {f.status === 'uploading' && (
                        <p className="mt-3 flex items-center gap-1 text-xs text-primary">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          מעלה עכשיו
                        </p>
                      )}
                      {f.status === 'done' && (
                        <p className="mt-3 flex items-center gap-1 text-xs text-success">
                          <Check className="h-3 w-3" />
                          הועלה בהצלחה
                        </p>
                      )}

                      {f.status === 'pending' && f.closestRecommendations.length > 0 && (
                        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 font-medium text-amber-600">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span>לא נמצאה התאמה מדויקת עם המידה <span dir="ltr">({f.width}×{f.height})</span>. אולי אחד מהפורמטים הבאים:</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {f.closestRecommendations.map((rec) => (
                                <Button
                                  key={rec.id}
                                  variant="outline"
                                  className="h-7 gap-1.5 border-amber-200 bg-background/80 px-2 text-[10px] hover:bg-amber-50"
                                  onClick={() => addChannelToCampaign(i, rec)}
                                >
                                  <span>{rec.name}</span>
                                  <span className="text-[9px] font-normal opacity-60" dir="ltr">({rec.size.split(' - ')[0]})</span>
                                </Button>
                              ))}
                              <Button
                                variant="outline"
                                className="h-7 gap-1.5 border-amber-200 bg-background/80 px-3 text-[10px] hover:bg-amber-50 font-bold"
                                onClick={(e) => {
                                  const targetCard = e.currentTarget.closest('.rounded-xl');

                                  // Clear the currently assigned channel and recommendations
                                  const updated = [...files];
                                  updated[i].assignedChannel = null;
                                  updated[i].closestRecommendations = [];
                                  setFiles(updated);

                                  // Wait for the re-render so the assignedChannel becomes null, then trigger the Select
                                  setTimeout(() => {
                                    const trigger = targetCard?.querySelector('[role="combobox"]');
                                    if (trigger instanceof HTMLElement) {
                                      trigger.focus();
                                      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                                    }
                                  }, 10);
                                }}
                              >
                                אחר
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col gap-3 border-t bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
            {rejectedFiles.length > 0 && (
              <div className="w-full rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-[11px] text-destructive relative sm:order-first sm:basis-full">
                <button
                  type="button"
                  onClick={() => setRejectedFiles([])}
                  className="absolute left-2 top-2 opacity-70 hover:opacity-100"
                  aria-label="סגירה"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <p className="font-semibold mb-1.5 pl-6">
                  {rejectedFiles.length} קבצים לא יעלו (
                  {rejectedFiles.filter((r) => r.type === 'duplicate').length > 0 && `${rejectedFiles.filter((r) => r.type === 'duplicate').length} כפילויות`}
                  {rejectedFiles.filter((r) => r.type === 'duplicate').length > 0 && rejectedFiles.filter((r) => r.type === 'oversized').length > 0 && ', '}
                  {rejectedFiles.filter((r) => r.type === 'oversized').length > 0 && `${rejectedFiles.filter((r) => r.type === 'oversized').length} גדולים מ-${maxSizeMbDisplay}MB`}
                  {rejectedFiles.filter((r) => r.type === 'upload_error').length > 0 && `, ${rejectedFiles.filter((r) => r.type === 'upload_error').length} שגיאות העלאה`}
                  ):
                </p>
                <ul className="space-y-1 max-h-28 overflow-y-auto pe-1">
                  {rejectedFiles.map((f, idx) => (
                    <li key={idx} className="flex flex-col gap-0.5 border-s-2 border-destructive/30 ps-2">
                      <span dir="ltr" className="text-right font-medium">{f.path.replace(/\//g, ' / ')}</span>
                      <span className="opacity-80">{f.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="w-full text-xs text-muted-foreground sm:w-auto">
              {uploading && uploadProgress
                ? `מעלה ${uploadProgress.current} מתוך ${uploadProgress.total} קבצים`
                : files.length === 0
                  ? g('בחר קבצים כדי להתחיל')
                  : uploadSummary
                    ? `הסתיים: ${completedCount} הועלו, ${rejectedFiles.length} לא עלו`
                    : `${pendingCount} ממתינים להעלאה`}
            </p>
            <div className="flex w-full gap-2 sm:w-auto sm:flex-row sm:items-center">
              {(uploadSummary || uploadFinished) ? (
                <Button onClick={() => { onUploaded(); onClose(); }} className="flex-1 sm:flex-none sm:w-auto bg-success text-success-foreground hover:bg-success/90">
                  סיום וסגירה
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={onClose} className="flex-1 sm:flex-none sm:w-auto">ביטול</Button>
                  <Button onClick={handleUpload} disabled={uploading || pendingCount === 0 || processing} className="flex-1 sm:flex-none sm:w-auto">
                    {uploading ? 'מעלה...' : g(`העלה ${pendingCount} קבצים`)}
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
      <FormatPickerDialog
        open={formatPickerIndex !== null}
        onClose={() => setFormatPickerIndex(null)}
        channels={mergedChannels}
        value={formatPickerIndex !== null ? files[formatPickerIndex]?.assignedChannel ?? null : null}
        onConfirm={(id) => {
          if (formatPickerIndex === null) return;
          const updated = [...files];
          updated[formatPickerIndex].assignedChannel = id;
          updated[formatPickerIndex].suggestedChannel = null;
          setFiles(updated);
        }}
      />
      <AlertDialog open={unassignedWarningOpen} onOpenChange={setUnassignedWarningOpen}>
        <AlertDialogContent dir="rtl" className="text-start">
          <AlertDialogHeader>
            <AlertDialogTitle>קבצים לא מסווגים</AlertDialogTitle>
            <AlertDialogDescription>
              ישנם קבצים שלא הוגדר להם פורמט. הם יועלו כסיווג ״לא מסווג״ ויחכו לסיווג בהמשך.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4 space-y-1 text-sm border bg-muted/30 p-3 rounded-md max-h-[150px] overflow-y-auto">
            {pendingUploadData?.filter(f => !f.assignedChannel).map((f, index) => (
              <div key={index} className="truncate text-muted-foreground" dir="ltr" style={{ textAlign: 'right' }}>
                {f.file.name}
              </div>
            ))}
          </div>
          <div className="text-sm font-medium mb-4">
            האם תרצה להמשיך בהעלאה?
          </div>
          <AlertDialogFooter className="flex-row gap-2 justify-start">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setUnassignedWarningOpen(false);
              if (!pendingUploadData) return;
              const missingTags = pendingUploadData.filter(f => f.selectedTags.length === 0);
              if (missingTags.length > 0) {
                setUnassignedTagsWarningOpen(true);
              } else {
                executeUpload(pendingUploadData);
              }
            }}>
              המשך העלאה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={unassignedTagsWarningOpen} onOpenChange={setUnassignedTagsWarningOpen}>
        <AlertDialogContent dir="rtl" className="text-start">
          <AlertDialogHeader>
            <AlertDialogTitle>קבצים ללא תגיות</AlertDialogTitle>
            <AlertDialogDescription>
              ישנם קבצים שלא הוגדרו להם תגיות. הם יועלו כסיווג ״לא מסווג״ ויחכו לסיווג בהמשך.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4 space-y-1 text-sm border bg-muted/30 p-3 rounded-md max-h-[150px] overflow-y-auto">
            {pendingUploadData?.filter(f => f.selectedTags.length === 0).map((f, index) => (
              <div key={index} className="truncate text-muted-foreground" dir="ltr" style={{ textAlign: 'right' }}>
                {f.file.name}
              </div>
            ))}
          </div>
          <div className="text-sm font-medium mb-4">
            האם תרצה להמשיך בהעלאה?
          </div>
          <AlertDialogFooter className="flex-row gap-2 justify-start">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setUnassignedTagsWarningOpen(false);
              if (pendingUploadData) executeUpload(pendingUploadData);
            }}>
              המשך העלאה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

// Tag multi-select component with hierarchical grouping
function TagSelector({ availableTags, selectedTags, onToggle, onMergeSuggestedTags, onAddTag, file, fileName, fileType, width, height }: {
  availableTags: TagOption[];
  selectedTags: string[];
  onToggle: (tagId: string) => void;
  onMergeSuggestedTags: (tagIds: string[]) => void;
  onAddTag: (name: string) => Promise<string | null>;
  file: File;
  fileName: string;
  fileType: string;
  width: number;
  height: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedTagIds, setSuggestedTagIds] = useState<string[]>([]);
  const g = useG();

  const parentTags = availableTags.filter(t => !t.parent_id);
  const getChildrenOf = (parentId: string) => availableTags.filter(t => t.parent_id === parentId);

  const parentsWithChildren = parentTags.filter(p => getChildrenOf(p.id).length > 0);
  const standaloneParents = parentTags.filter(p => getChildrenOf(p.id).length === 0);

  const q = search.trim().toLowerCase();

  const filteredParentsWithChildren = q
    ? parentsWithChildren.filter(p => p.name.toLowerCase().includes(q) || getChildrenOf(p.id).some(c => c.name.toLowerCase().includes(q)))
    : parentsWithChildren;

  const filteredStandalone = q
    ? standaloneParents.filter(t => t.name.toLowerCase().includes(q))
    : standaloneParents;

  const filteredChildrenOf = (parentId: string) => {
    const children = getChildrenOf(parentId);
    if (!q) return children;
    const parent = availableTags.find(t => t.id === parentId);
    if (parent?.name.toLowerCase().includes(q)) return children;
    return children.filter(c => c.name.toLowerCase().includes(q));
  };

  const showCreate = search.trim().length > 0 && !availableTags.some(t => t.name.toLowerCase() === search.trim().toLowerCase());

  const handleCreate = async () => {
    setAdding(true);
    const newId = await onAddTag(search.trim());
    if (newId) {
      onToggle(newId);
      setSearch('');
    }
    setAdding(false);
  };

  const suggestTags = async () => {
    setSuggesting(true);
    try {
      let imageDataUrl: string | undefined;

      // Keep payload bounded to avoid large request failures.
      if (file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024) {
        imageDataUrl = await fileToDataUrl(file);
      }

      const { data, error } = await supabase.functions.invoke('suggest-tags', {
        body: { fileName, fileType, width, height, imageDataUrl },
      });

      if (error) throw error;

      const validSuggestedTagIds = Array.isArray(data?.tagIds)
        ? (data.tagIds as string[]).filter((tagId) => availableTags.some((tag) => tag.id === tagId))
        : [];

      setSuggestedTagIds(validSuggestedTagIds);

      if (validSuggestedTagIds.length === 0) {
        toast.info('לא נמצאו תגיות מוצעות לקובץ');
      } else {
        toast.success(`נמצאו ${validSuggestedTagIds.length} תגיות מוצעות`);
      }
    } catch (e: any) {
      toast.error('שגיאה בהצעת תגיות');
    } finally {
      setSuggesting(false);
    }
  };

  const suggestedTags = suggestedTagIds
    .map((tagId) => availableTags.find((tag) => tag.id === tagId))
    .filter(Boolean) as TagOption[];
  const notSelectedSuggestedTagIds = suggestedTagIds.filter((tagId) => !selectedTags.includes(tagId));

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Popover open={open} onOpenChange={setOpen} modal={true}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={`h-8 flex-1 justify-start text-xs ${selectedTags.length === 0 ? 'border-destructive text-muted-foreground' : ''}`}
            >
              {selectedTags.length === 0 ? g('בחר תגיות...') : `${selectedTags.length} תגיות נבחרו`}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            dir="rtl"
            className="z-[100] w-[min(280px,calc(100vw-3rem))] max-h-80 overflow-hidden p-0 text-start"
            align="start"
            side="bottom"
            sideOffset={4}
            collisionPadding={12}
          >
            <Command shouldFilter={false}>
              <CommandInput placeholder={g("חפש תגית...")} className="h-8 text-xs" value={search} onValueChange={setSearch} />
              <CommandList className="max-h-72 overflow-y-auto overscroll-contain">
                {filteredParentsWithChildren.map(parent => (
                  <CommandGroup key={parent.id} heading={parent.name}>
                    {filteredChildrenOf(parent.id).map(tag => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() => onToggle(tag.id)}
                        className="text-xs transition-colors duration-200"
                      >
                        <div className={`w-3.5 h-3.5 rounded border ms-2 flex-shrink-0 flex items-center justify-center transition-all duration-300 ${selectedTags.includes(tag.id) ? 'bg-primary border-primary scale-110' : 'border-input hover:border-primary/50'}`}>
                          {selectedTags.includes(tag.id) && <Check className="w-2 h-2 text-primary-foreground animate-in zoom-in-50 duration-300" />}
                        </div>
                        {tag.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
                {filteredStandalone.length > 0 && (
                  <CommandGroup heading="כללי">
                    {filteredStandalone.map(tag => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() => onToggle(tag.id)}
                        className="text-xs transition-colors duration-200"
                      >
                        <div className={`w-3.5 h-3.5 rounded border ms-2 flex-shrink-0 flex items-center justify-center transition-all duration-300 ${selectedTags.includes(tag.id) ? 'bg-primary border-primary scale-110' : 'border-input hover:border-primary/50'}`}>
                          {selectedTags.includes(tag.id) && <Check className="w-2 h-2 text-primary-foreground animate-in zoom-in-50 duration-300" />}
                        </div>
                        {tag.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {filteredParentsWithChildren.length === 0 && filteredStandalone.length === 0 && !showCreate && (
                  <div className="text-xs p-2 text-center text-muted-foreground">לא נמצאו תגיות</div>
                )}
                {showCreate && (
                  <CommandGroup>
                    <CommandItem
                      onSelect={handleCreate}
                      className="text-xs text-primary font-medium bg-primary/5 hover:bg-primary/10 transition-colors animate-in fade-in slide-in-from-top-1 duration-200"
                      disabled={adding}
                    >
                      <Plus className="w-3.5 h-3.5 ms-2 flex-shrink-0" />
                      {adding ? g('מוסיף...') : `צור תגית חדשה: "${search.trim()}"`}
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          title="הצע תגיות עם AI"
          onClick={suggestTags}
          disabled={suggesting}
        >
          {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {suggestedTags.length > 0 && (
        <div className="mt-1 rounded-md border bg-muted/20 p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">הצעות תגיות AI</span>
            {notSelectedSuggestedTagIds.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => onMergeSuggestedTags(notSelectedSuggestedTagIds)}
              >
                הוסף הכל
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {suggestedTags.map((tag) => {
              const alreadySelected = selectedTags.includes(tag.id);
              return (
                <Button
                  key={tag.id}
                  type="button"
                  variant={alreadySelected ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-6 gap-1 px-2 text-[10px]"
                  disabled={alreadySelected}
                  onClick={() => onMergeSuggestedTags([tag.id])}
                >
                  {!alreadySelected && <Plus className="h-3 w-3" />}
                  {tag.name}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected tags chips - below trigger to prevent layout shift */}
      {selectedTags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 rounded-md border bg-muted/30 p-2 animate-in fade-in slide-in-from-top-1 duration-300">
          {selectedTags.map(tid => {
            const tag = availableTags.find(t => t.id === tid);
            if (!tag) return null;
            return (
              <Badge
                key={tid}
                variant="secondary"
                className="gap-1 px-1.5 py-0 text-[10px] animate-in zoom-in-95 fade-in duration-300 transition-all hover:bg-secondary/80"
              >
                {tag.name}
                <button onClick={(e) => { e.stopPropagation(); onToggle(tid); }} className="hover:text-destructive transition-colors">
                  <X className="w-2.5 h-2.5" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AiTitleButton({ fileName, fileType, width, height, onSuggested }: {
  fileName: string;
  fileType: string;
  width: number;
  height: number;
  onSuggested: (title: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  const suggest = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-title', {
        body: { fileName, fileType, width, height },
      });
      if (error) throw error;
      if (data?.title) {
        onSuggested(data.title);
        toast.success('כותרת הוצעה בהצלחה');
      } else if (data?.error) {
        toast.error(data.error);
      }
    } catch (e: any) {
      toast.error('שגיאה בהצעת כותרת');
    }
    setLoading(false);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-9 w-9 shrink-0"
      onClick={suggest}
      disabled={loading}
      title="הצע כותרת עם AI"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
    </Button>
  );
}

export { AiTitleButton };
