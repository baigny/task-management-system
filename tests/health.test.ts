import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

describe('HTTP foundation', () => {
  it('reports health and hides implementation headers', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  it('returns a consistent unknown-route error', async () => {
    const response = await request(app).get('/unknown').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
  it('rejects invalid JSON and oversized bodies consistently', async () => {
    const malformed = await request(app).post('/unknown').set('Content-Type', 'application/json').send('{').expect(400);
    expect(malformed.body.error.code).toBe('INVALID_BODY');
    const oversized = await request(app).post('/unknown').send({ data: 'a'.repeat(110000) }).expect(413);
    expect(oversized.body.error.code).toBe('INVALID_BODY');
  });
  it('serves its API contract and Swagger assets', async () => {
    const contract = await request(app).get('/openapi.json').expect(200);
    expect(contract.body.paths['/health'].get).toBeDefined();
    await request(app).get('/docs/').expect(200);
  });
});
