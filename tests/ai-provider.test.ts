import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', async importOriginal => {
  const sdk = await importOriginal<typeof import('@google/genai')>();
  return { ...sdk, GoogleGenAI: class { models = { generateContent }; } };
});
import { ApiError as GoogleApiError } from '@google/genai';
import { generateSuggestion } from '../src/ai/provider.js';
import { config } from '../src/config.js';

const original = { key: config.GEMINI_API_KEY, timeout: config.GEMINI_TIMEOUT_MS };
beforeEach(() => { config.GEMINI_API_KEY = 'unit-test-key'; generateContent.mockReset(); });
afterEach(() => { config.GEMINI_API_KEY = original.key; config.GEMINI_TIMEOUT_MS = original.timeout; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Gemini provider boundary', () => {
  it('returns trimmed suggestions with the configured model and bounded SDK options', async () => {
    generateContent.mockResolvedValue({ text: '  Useful description  ', candidates: [{ finishReason: 'STOP' }] });
    expect(await generateSuggestion('instruction', 'idea')).toEqual({ text: 'Useful description', model: config.GEMINI_MODEL });
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: config.GEMINI_MODEL, contents: 'idea',
      config: expect.objectContaining({ abortSignal: expect.any(AbortSignal), httpOptions: { timeout: config.GEMINI_TIMEOUT_MS, retryOptions: { attempts: 1 } } }),
    }));
  });
  it('keeps the optional provider disabled when no key is configured', async () => {
    config.GEMINI_API_KEY = '';
    await expect(generateSuggestion('instruction', 'idea')).rejects.toMatchObject({ status: 503, code: 'AI_NOT_CONFIGURED' });
    expect(generateContent).not.toHaveBeenCalled();
  });
  it('rejects empty, blocked, truncated, and oversized suggestions', async () => {
    for (const response of [{ text: '' }, { text: 'partial', candidates: [{ finishReason: 'MAX_TOKENS' }] }, { text: 'blocked', candidates: [{ finishReason: 'SAFETY' }] }, { text: 'x'.repeat(10001) }]) {
      generateContent.mockResolvedValueOnce(response);
      await expect(generateSuggestion('instruction', 'idea')).rejects.toMatchObject({ status: 502, code: 'AI_INVALID_RESPONSE' });
    }
  });
  it('bounds even an unresponsive provider promise and aborts the SDK request', async () => {
    vi.useFakeTimers();
    config.GEMINI_TIMEOUT_MS = 1000;
    generateContent.mockImplementation(() => new Promise(() => {}));
    const result = expect(generateSuggestion('instruction', 'idea')).rejects.toMatchObject({ status: 504, code: 'AI_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(generateContent.mock.calls[0][0].config.abortSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('hides provider details and maps quota failures to a retryable response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    generateContent.mockRejectedValueOnce(new GoogleApiError({ status: 429, message: 'secret-provider-details' }));
    await expect(generateSuggestion('instruction', 'idea')).rejects.toMatchObject({ status: 503, code: 'AI_UNAVAILABLE', retryAfter: 30 });
    generateContent.mockRejectedValueOnce(new Error('unit-test-key private provider URL'));
    await expect(generateSuggestion('instruction', 'idea')).rejects.toMatchObject({ status: 502, code: 'AI_PROVIDER_ERROR', message: 'Gemini assistance failed' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('unit-test-key');
  });
});
