import { open } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
const formats: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/** Resolve only generated UUID storage keys inside the configured private directory. */
export function storagePath(key: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key)) throw new Error('Invalid storage key');
  return resolve(config.UPLOAD_DIR, key);
}

/** Match allowlisted extensions and declared media types before consuming file content. */
export function validateFileName(name: string, mimeType: string) {
  const hasControl = Array.from(name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  if (!name.trim() || name.length > 200 || hasControl || /[/\\]/.test(name) || formats[extname(name).toLowerCase()] !== mimeType) {
    throw new ApiError(415, 'UNSUPPORTED_FILE', 'Use PDF, PNG, or JPEG with a matching file extension and media type');
  }
}

/** Verify PDF, PNG, and JPEG signatures before accepting the privately stored file. */
export async function validateFileContent(file: Express.Multer.File) {
  validateFileName(file.originalname, file.mimetype);
  if (!file.size) throw new ApiError(400, 'EMPTY_FILE', 'File must not be empty');
  const handle = await open(storagePath(file.filename), 'r');
  const header = Buffer.alloc(8);
  let length: number;
  try { length = (await handle.read(header, 0, header.length, 0)).bytesRead; }
  finally { await handle.close(); }
  const bytes = header.subarray(0, length);
  let valid = false;
  switch (file.mimetype) {
    case 'application/pdf': valid = bytes.subarray(0, 5).equals(Buffer.from('%PDF-')); break;
    case 'image/png': valid = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); break;
    case 'image/jpeg': valid = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255; break;
  }
  if (!valid) throw new ApiError(415, 'UNSUPPORTED_FILE', 'File content does not match the allowed media type');
}
