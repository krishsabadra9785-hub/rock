import type { ReceiptImageRef } from '../domain/types';

/**
 * Receipt image storage abstraction.
 *
 * V1 (Spark / no-cost plan): NoPermanentStorageProvider. The receipt image is
 * used in the browser for preview and AI reading, then discarded. Only the
 * confirmed text fields are saved to Firestore — never the image, Base64,
 * blobs or data URLs.
 *
 * Future: a FirebaseStorageProvider (or any other) can implement this same
 * interface and be swapped in below. Orders already carry a ReceiptImageRef,
 * so the order system does not need to change. See docs/ARCHITECTURE.md.
 */
export interface ReceiptStorageProvider {
  readonly id: ReceiptImageRef['provider'];
  /** Whether images are kept permanently (controls UI wording/previews). */
  readonly persistsImages: boolean;
  /** Called once when an order is confirmed. Returns the reference saved on the order. */
  save(file: Pick<File, 'name' | 'type' | 'size'>, ctx: { orderKey: string }): Promise<ReceiptImageRef>;
  /** A viewable URL for a stored image, or null when nothing was stored. */
  getViewUrl(ref: ReceiptImageRef): Promise<string | null>;
}

export class NoPermanentStorageProvider implements ReceiptStorageProvider {
  readonly id = 'NONE' as const;
  readonly persistsImages = false;

  async save(file: Pick<File, 'name' | 'type' | 'size'>): Promise<ReceiptImageRef> {
    // Metadata only — useful for audit ("a 2.1 MB JPEG was read"), no content.
    return {
      provider: 'NONE',
      ref: null,
      fileName: file.name ? file.name.slice(0, 120) : null,
      contentType: file.type || null,
      sizeBytes: Number.isFinite(file.size) ? file.size : null,
    };
  }

  async getViewUrl(): Promise<string | null> {
    return null;
  }
}

export const NO_RECEIPT_IMAGE: ReceiptImageRef = { provider: 'NONE', ref: null, fileName: null, contentType: null, sizeBytes: null };

/** The active provider. Swap this line to enable permanent storage in future. */
export const receiptStorage: ReceiptStorageProvider = new NoPermanentStorageProvider();
