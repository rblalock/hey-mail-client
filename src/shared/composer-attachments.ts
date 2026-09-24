export const MAX_COMPOSER_FILES = 25;
// Local import limits; HEY may impose a smaller delivery limit.
export const MAX_COMPOSER_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_COMPOSER_BATCH_BYTES = 100 * 1024 * 1024;

export type ComposerFileInput = { name: string; bytes: Uint8Array };
export type ComposerFile = { path: string; name: string; byteSize?: number; previewUrl?: string };

export function validateComposerFiles(files: { name: string; size: number }[], existingCount = 0): void {
  if (!files.length || files.length + existingCount > MAX_COMPOSER_FILES) throw new Error("Attach up to 25 files per message.");
  if (files.some((file) => !Number.isSafeInteger(file.size) || file.size <= 0)) throw new Error("Empty files cannot be attached.");
  if (files.some((file) => file.size > MAX_COMPOSER_FILE_BYTES)) throw new Error("Attach files smaller than 50 MB each.");
  if (files.reduce((total, file) => total + file.size, 0) > MAX_COMPOSER_BATCH_BYTES) throw new Error("Add fewer files at once (100 MB per import).");
}
