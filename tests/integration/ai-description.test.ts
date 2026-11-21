import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import * as provider from '../../src/ai/provider.js';
import { aiLimiter } from '../../src/ai/routes.js';
import { ApiError } from '../../src/errors.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
const path = '/api/v1/ai/descriptions';
/** Use real database sessions while replacing only the outbound provider. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
beforeAll(async () => { users = await accounts(2); });
afterEach(() => { vi.restoreAllMocks(); users.forEach(user => { aiLimiter.resetKey(user.id); }); });
afterAll(async () => { await cleanup(users.map(user => user.id)); });

describe('description assistance', () => {
  it('requires authentication and validates bounded, closed request schemas before generation', async () => {
    const generate = vi.spyOn(provider, 'generateSuggestion').mockRejectedValue(new Error('Unexpected provider call'));
    await request(app).post(path).send({ input: 'idea' }).expect(401);
    for (const body of [{}, { input: '  ' }, { input: 'x'.repeat(2001) }, { input: 'idea', apiKey: 'not-accepted' }]) {
      await request(app).post(path).set(auth()).send(body).expect(400);
    }
    await request(app).post(`${path}?model=other`).set(auth()).send({ input: 'idea' }).expect(400);
    expect(generate).not.toHaveBeenCalled();
  });
  it('returns a suggestion without changing task, history, or notification records', async () => {
    const before = await Promise.all([db.task.count(), db.activity.count(), db.notification.count()]);
    const generate = vi.spyOn(provider, 'generateSuggestion').mockResolvedValue({ text: 'Steps and acceptance criteria', model: 'mock-gemini' });
    const response = await request(app).post(path).set(auth()).send({ input: '  Export tasks  ' }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ description: 'Steps and acceptance criteria', model: 'mock-gemini' });
    expect(JSON.parse(generate.mock.calls[0][1])).toEqual({ idea: 'Export tasks' });
    expect(await Promise.all([db.task.count(), db.activity.count(), db.notification.count()])).toEqual(before);
  });
  it('returns expected configuration, timeout, and provider errors without breaking health', async () => {
    const generate = vi.spyOn(provider, 'generateSuggestion');
    for (const [status, code] of [[503, 'AI_NOT_CONFIGURED'], [504, 'AI_TIMEOUT'], [502, 'AI_PROVIDER_ERROR']] as const) {
      generate.mockRejectedValueOnce(new ApiError(status, code, 'Safe public message'));
      const response = await request(app).post(path).set(auth()).send({ input: 'idea' }).expect(status);
      expect(response.body.error.code).toBe(code);
    }
    await request(app).get('/health').expect(200);
  });
  it('limits generation per account without blocking another account', async () => {
    const generate = vi.spyOn(provider, 'generateSuggestion').mockResolvedValue({ text: 'Suggestion', model: 'mock-gemini' });
    for (let index = 0; index < 10; index++) await request(app).post(path).set(auth()).send({ input: 'idea' }).expect(200);
    const limited = await request(app).post(path).set(auth()).send({ input: 'idea' }).expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
    await request(app).post(path).set(auth(1)).send({ input: 'idea' }).expect(200);
    expect(generate).toHaveBeenCalledTimes(11);
  });
});
