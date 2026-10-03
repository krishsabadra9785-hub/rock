import { AppError } from './errors';

/**
 * Temporary, in-browser handling of a receipt photo. Nothing here uploads or
 * persists the image: it lives in memory as a File plus a blob: preview URL,
 * and must be released with `releasePreview` when the workflow ends.
 */

export function createPreview(file: Blob): string {
  return URL.createObjectURL(file);
}

export function releasePreview(url: string | null | undefined): void {
  if (url) URL.revokeObjectURL(url);
}

/** Shrinks large photos before sending them to the AI (faster, fits free-tier limits). PDFs pass through. */
export async function prepareForAi(file: File, maxSide = 1800): Promise<{ base64: string; mimeType: string }> {
  if (file.type === 'application/pdf') {
    if (file.size > 7 * 1024 * 1024) throw new AppError('PDF is too large for automatic reading. Enter the details manually.');
    return { base64: await blobToBase64(file), mimeType: file.type };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
      bitmap.close();
      return { base64: await blobToBase64(file), mimeType: file.type };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encode failed'))), 'image/jpeg', 0.85));
    const out = { base64: await blobToBase64(blob), mimeType: 'image/jpeg' };
    canvas.width = 0;
    canvas.height = 0;
    return out;
  } catch {
    return { base64: await blobToBase64(file), mimeType: file.type };
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new AppError('Could not read the file'));
    r.readAsDataURL(blob);
  });
}
