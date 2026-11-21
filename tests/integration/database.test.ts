import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { app, createApp } from '../../src/app.js';
import { db } from '../../src/db.js';

describe('PostgreSQL readiness', () => {
  afterAll(async () => { await db.$disconnect(); });
  it('uses the isolated database and reports readiness', async () => {
    const [result] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    expect(result.name).toBe('task_management_test');
    await request(app).get('/ready').expect(200, { status: 'ready' });
  });
  it('returns 503 when PostgreSQL is unreachable, while health stays available', async () => {
    const unavailable = new PrismaClient({ datasourceUrl: 'postgresql://taskapp:taskapp@127.0.0.1:1/task_management_test?connect_timeout=1' });
    try {
      const instance = createApp(() => unavailable.$queryRaw`SELECT 1`);
      const response = await request(instance).get('/ready').expect(503);
      expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
      await request(instance).get('/health').expect(200);
    } finally { await unavailable.$disconnect(); }
  });
});
