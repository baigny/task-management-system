import { GoogleGenAI, ApiError as GoogleApiError } from '@google/genai';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { logOperation } from '../logging.js';

let client: GoogleGenAI | undefined;

/** Generate bounded plain text without exposing provider credentials, prompts, or error details. */
export async function generateSuggestion(instruction: string, input: string) {
  if (!config.GEMINI_API_KEY) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Gemini assistance is not configured');
  client ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY, vertexai: false });
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new ApiError(504, 'AI_TIMEOUT', 'Gemini did not respond in time'));
      controller.abort();
    }, config.GEMINI_TIMEOUT_MS);
    timer.unref();
  });
  try {
    const response = await Promise.race([
      client.models.generateContent({
        model: config.GEMINI_MODEL, contents: input,
        config: {
          systemInstruction: instruction, responseMimeType: 'text/plain', maxOutputTokens: 2048,
          abortSignal: controller.signal,
          // A single bounded attempt avoids multiplying cost and latency on provider failures.
          httpOptions: { timeout: config.GEMINI_TIMEOUT_MS, retryOptions: { attempts: 1 } },
        },
      }),
      deadline,
    ]);
    const text = response.text?.trim();
    const finishReason = response.candidates?.[0]?.finishReason;
    if (!text || text.length > 10_000 || (finishReason && finishReason !== 'STOP')) {
      throw new ApiError(502, 'AI_INVALID_RESPONSE', 'Gemini could not provide a complete suggestion');
    }
    return { text, model: config.GEMINI_MODEL };
  } catch (error) {
    if (timedOut || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) {
      throw new ApiError(504, 'AI_TIMEOUT', 'Gemini did not respond in time');
    }
    if (error instanceof ApiError) throw error;
    logOperation('error', 'ai.provider_failed');
    if (error instanceof GoogleApiError && [429, 503].includes(error.status)) {
      throw new ApiError(503, 'AI_UNAVAILABLE', 'Gemini is temporarily unavailable', 30);
    }
    throw new ApiError(502, 'AI_PROVIDER_ERROR', 'Gemini assistance failed');
  } finally { clearTimeout(timer); }
}
