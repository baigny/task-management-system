import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { config } from '../src/config.js';
import { storagePath, validateFileName } from '../src/attachments/storage.js';

describe('private attachment storage boundaries', () => {
  it('resolves only generated UUID keys inside the configured directory', () => {
    const key = '12345678-1234-4234-8234-123456789abc';
    expect(storagePath(key)).toBe(resolve(config.UPLOAD_DIR, key));
    for (const invalid of ['../secret', 'C:\\secret.pdf', '/etc/passwd', `${key}.pdf`, 'not-a-key']) {
      expect(() => storagePath(invalid)).toThrow('Invalid storage key');
    }
  });
  it('rejects unsupported extensions, mismatched MIME types, paths, and control characters', () => {
    for (const [name, mime] of [
      ['file.txt', 'text/plain'], ['file.pdf.exe', 'application/pdf'], ['file.pdf', 'image/png'],
      ['../file.pdf', 'application/pdf'], ['folder\\file.pdf', 'application/pdf'],
      [`file${String.fromCharCode(0)}.pdf`, 'application/pdf'], [`file${String.fromCharCode(13)}.pdf`, 'application/pdf'],
    ]) expect(() => validateFileName(name, mime)).toThrow();
    expect(() => validateFileName('DESIGN.PDF', 'application/pdf')).not.toThrow();
  });
});
