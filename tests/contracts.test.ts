import SwaggerParser from '@apidevtools/swagger-parser';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createApp } from '../src/app.js';
import { openapi, operations } from '../src/openapi.js';
import { postmanCollection } from '../scripts/postman-collection.js';

describe('API contracts', () => {
  it('validates the OpenAPI specification', async () => {
    await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(openapi)))).resolves.toBeDefined();
  });
  it('keeps Postman methods and paths aligned with Swagger', () => {
    const collection = postmanCollection();
    expect(collection.item).toHaveLength(operations.length);
    for (const operation of operations) {
      expect(collection.item.some(item => item.request.method === operation.method.toUpperCase()
        && item.request.url.startsWith('{{baseUrl}}' + operation.path.replace(/\{(\w+)\}/g, '{{$1}}')))).toBe(true);
    }
  });
  it('serves the contract and matches health/readiness examples', async () => {
    const published = await request(app).get('/openapi.json').expect(200);
    expect(published.body).toEqual(JSON.parse(JSON.stringify(openapi)));
    await request(app).get('/health').expect(200, { status: 'ok' });
    const instance = createApp(async () => { throw new Error('unavailable'); });
    await request(instance).get('/ready').expect(503, { error: { code: 'DATABASE_UNAVAILABLE', message: 'Database unavailable' } });
  });
});
