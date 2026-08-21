// Convert a DataTransferItemList (from a drop event) into a flat list of Files,
// recursively traversing any folders. Each returned File has its
// `webkitRelativePath` set to the path under the dropped root (so existing
// folder-tag logic in AssetUploadModal keeps working).
export async function filesFromDropItems(items: DataTransferItemList): Promise<File[]> {
  const entries: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    // webkitGetAsEntry is the only cross-browser way to detect folder drops
    const entry = (it as any).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  const out: File[] = [];
  await Promise.all(entries.map((e) => walkEntry(e, '', out)));
  return out;
}

async function walkEntry(entry: any, prefix: string, out: File[]): Promise<void> {
  if (!entry) return;
  if (entry.isFile) {
    const file: File = await new Promise((resolve, reject) =>
      entry.file((f: File) => resolve(f), reject)
    );
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    try {
      Object.defineProperty(file, 'webkitRelativePath', {
        value: rel,
        configurable: true,
      });
    } catch {
      /* ignore */
    }
    out.push(file);
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const all: any[] = [];
    // readEntries returns at most ~100 entries per call — loop until empty
    const readBatch = (): Promise<any[]> =>
      new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    while (true) {
      const batch = await readBatch();
      if (!batch.length) break;
      all.push(...batch);
    }
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    await Promise.all(all.map((c) => walkEntry(c, nextPrefix, out)));
  }
}