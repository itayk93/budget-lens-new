import * as pdfjsLib from 'pdfjs-dist';
// @ts-expect-error Vite resolves worker assets imported with the ?url suffix.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Split a PDF File into a list of JPG image Files, one per page.
 * Page images are rendered at 2x for decent quality.
 *
 * Returns a deterministic content hash per page that is derived from the
 * source PDF bytes + page number (NOT from the rendered JPEG, which is
 * non-deterministic across renders due to anti-aliasing/encoder variance).
 * This makes duplicate detection reliable across re-uploads of the same PDF.
 */
export async function splitPdfToImages(
  file: File,
  onPage?: (pageNum: number, totalPages: number) => void
): Promise<{ file: File; hash: string }[]> {
  const buf = await file.arrayBuffer();
  // Compute one stable hash for the source PDF bytes
  const srcHashBuf = await crypto.subtle.digest('SHA-256', buf);
  const srcHashHex = Array.from(new Uint8Array(srcHashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const pdf = await (pdfjsLib as any).getDocument({ data: buf }).promise;
  const baseName = file.name.replace(/\.pdf$/i, '');
  const out: { file: File; hash: string }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onPage?.(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    const blob: Blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b as Blob), 'image/jpeg', 0.9)
    );
    if (!blob) continue;
    // Deterministic per-page hash: tied to the original PDF content + page index
    const pageKey = `pdf:${srcHashHex}:page:${i}`;
    const pageKeyBuf = new TextEncoder().encode(pageKey);
    const pageHashBuf = await crypto.subtle.digest('SHA-256', pageKeyBuf);
    const pageHash = Array.from(new Uint8Array(pageHashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    out.push({
      file: new File([blob], `${baseName}_עמוד_${i}.jpg`, { type: 'image/jpeg' }),
      hash: pageHash,
    });
    // Yield to UI thread so progress repaints
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}
