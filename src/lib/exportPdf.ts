import { jsPDF } from 'jspdf';

interface PdfAsset {
  original_file_name: string;
  file_type: string;
  width: number | null;
  height: number | null;
  file_size: number | null;
  publicUrl: string;
}

interface PdfChannel {
  name: string;
  assets: PdfAsset[];
}

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function generateVideoThumbnail(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';

    video.onloadeddata = () => {
      video.currentTime = 1;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 120;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, 160, 120);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
      URL.revokeObjectURL(video.src);
    };

    video.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(video.src);
    };

    setTimeout(() => resolve(null), 5000);
    video.src = url;
  });
}

export async function exportCampaignPdf(
  campaignName: string,
  channels: PdfChannel[],
  onProgress?: (current: number, total: number) => void
) {
  const totalAssets = channels.reduce((sum, ch) => sum + ch.assets.length, 0);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;

  // Title page
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(204, 0, 0);
  doc.text(campaignName, pageWidth / 2, 50, { align: 'center' });

  doc.setFontSize(12);
  doc.setTextColor(100);
  doc.text(`${totalAssets} נכסים | ${channels.length} ערוצים`, pageWidth / 2, 65, { align: 'center' });
  doc.text(new Date().toLocaleDateString('he-IL'), pageWidth / 2, 75, { align: 'center' });

  let processed = 0;
  const thumbW = 35;
  const thumbH = 26;
  const colsPerRow = Math.floor(contentWidth / (thumbW + 4));

  for (const channel of channels) {
    if (channel.assets.length === 0) continue;

    doc.addPage();
    let y = margin;

    // Channel header
    doc.setFillColor(204, 0, 0);
    doc.rect(margin, y, contentWidth, 10, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text(channel.name, pageWidth / 2, y + 7, { align: 'center' });
    y += 16;

    for (let i = 0; i < channel.assets.length; i++) {
      const asset = channel.assets[i];
      const col = i % colsPerRow;
      const row = Math.floor(i / colsPerRow);

      const x = margin + col * (thumbW + 4);
      const currentY = y + row * (thumbH + 18);

      // Check page overflow
      if (currentY + thumbH + 18 > pageHeight - margin) {
        doc.addPage();
        y = margin;
        // Recalculate row position on new page
        const adjustedI = i;
        const newRow = 0;
        const newCol = adjustedI % colsPerRow;
        const newX = margin + newCol * (thumbW + 4);
        const newY = y + newRow * (thumbH + 18);

        // Draw thumbnail
        await drawAssetThumbnail(doc, asset, newX, newY, thumbW, thumbH);
        processed++;
        onProgress?.(processed, totalAssets);
        continue;
      }

      await drawAssetThumbnail(doc, asset, x, currentY, thumbW, thumbH);
      processed++;
      onProgress?.(processed, totalAssets);
    }
  }

  doc.save(`${campaignName}.pdf`);
}

async function drawAssetThumbnail(
  doc: jsPDF,
  asset: PdfAsset,
  x: number,
  y: number,
  w: number,
  h: number
) {
  // Border
  doc.setDrawColor(200);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h);

  if (asset.file_type.startsWith('image')) {
    const b64 = await loadImageAsBase64(asset.publicUrl);
    if (b64) {
      try {
        const format = asset.file_type.includes('png') ? 'PNG' : 'JPEG';
        doc.addImage(b64, format, x + 0.5, y + 0.5, w - 1, h - 1);
      } catch {
        drawPlaceholder(doc, x, y, w, h, 'IMG');
      }
    } else {
      drawPlaceholder(doc, x, y, w, h, 'IMG');
    }
  } else if (asset.file_type.startsWith('video')) {
    const thumb = await generateVideoThumbnail(asset.publicUrl);
    if (thumb) {
      try {
        doc.addImage(thumb, 'JPEG', x + 0.5, y + 0.5, w - 1, h - 1);
      } catch {
        drawPlaceholder(doc, x, y, w, h, '▶ VIDEO');
      }
    } else {
      drawPlaceholder(doc, x, y, w, h, '▶ VIDEO');
    }
  } else {
    drawPlaceholder(doc, x, y, w, h, asset.file_type.split('/')[1]?.toUpperCase() || 'FILE');
  }

  // File info below thumbnail
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(80);
  const name = asset.original_file_name.length > 20
    ? asset.original_file_name.slice(0, 18) + '...'
    : asset.original_file_name;
  doc.text(name, x, y + h + 4);

  const meta = [
    asset.width && asset.height ? `${asset.width}x${asset.height}` : '',
    formatSize(asset.file_size),
  ].filter(Boolean).join(' | ');
  if (meta) {
    doc.setFontSize(5);
    doc.setTextColor(140);
    doc.text(meta, x, y + h + 8);
  }
}

function drawPlaceholder(doc: jsPDF, x: number, y: number, w: number, h: number, label: string) {
  doc.setFillColor(240, 240, 240);
  doc.rect(x + 0.5, y + 0.5, w - 1, h - 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(160);
  doc.text(label, x + w / 2, y + h / 2, { align: 'center' });
}
