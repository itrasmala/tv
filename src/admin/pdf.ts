// تحويل ملف PDF إلى صور JPEG داخل المتصفح (لا يُرفع الـ PDF نفسه).
// مكتبة pdf.js تُحمَّل فقط عند الحاجة، فلا تُثقل لوحة الإدارة ولا تصل لشاشة العرض أبدًا.

export const MAX_PDF_PAGES = 40;
export const MAX_PDF_MB = 40;

export interface PdfProgress { done: number; total: number; }

export async function pdfToImages(
  file: File,
  opts: { maxWidth: number; maxHeight: number; onProgress?: (p: PdfProgress) => void },
): Promise<{ blobs: Blob[]; totalPages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const totalPages = doc.numPages;
  const total = Math.min(totalPages, MAX_PDF_PAGES);
  const blobs: Blob[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      opts.onProgress?.({ done: i - 1, total });
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(opts.maxWidth / base.width, opts.maxHeight / base.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('المتصفح لا يدعم الرسم على Canvas');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
      if (!blob) throw new Error(`تعذّر تحويل الصفحة ${i}`);
      blobs.push(blob);
      page.cleanup();
      canvas.width = canvas.height = 0; // تحرير الذاكرة
    }
    opts.onProgress?.({ done: total, total });
  } finally {
    await doc.destroy();
  }
  return { blobs, totalPages };
}
