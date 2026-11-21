import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { getAuth } from '../src/auth/middleware.js';
import { errorHandler } from '../src/errors.js';

// A controller must fail closed when mounted without its authentication middleware.
describe('authenticated request context', () => {
  it('returns 401 rather than trusting a missing context', async () => {
    const app = express();
    app.get('/protected', (req, res) => { res.json({ userId: getAuth(req).userId }); });
    app.use(errorHandler);
    const response = await request(app).get('/protected').expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});
