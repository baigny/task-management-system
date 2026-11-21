import { describe, expect, it } from 'vitest';
import { NotificationType } from '@prisma/client';
import type { OpenAPIV3 } from 'openapi-types';
import { schemas } from '../src/openapi.js';
import { taskInput, taskUpdate } from '../src/tasks/validation.js';
import { descriptionInput, summaryInput } from '../src/ai/validation.js';
import { validateFileName } from '../src/attachments/storage.js';

/** Inspect the published field contract without treating schema references as inline definitions. */
function property(schemaName: string, field: string): OpenAPIV3.SchemaObject {
  const schema = schemas[schemaName];
  if (!schema || '$ref' in schema) throw new Error('Expected inline object schema');
  const value = schema.properties?.[field];
  if (!value || '$ref' in value) throw new Error('Expected inline field schema');
  return value;
}

describe('validation and published content boundaries', () => {
  it('keeps create/update validation aligned with documented task title and description limits', () => {
    for (const [field, maximum] of [['title', 200], ['description', 10000]] as const) {
      expect(property('TaskInput', field).maxLength).toBe(maximum);
      expect(property('TaskUpdate', field).maxLength).toBe(maximum);
      expect(taskInput.safeParse({ title: 'Task', [field]: 'x'.repeat(maximum) }).success).toBe(true);
      expect(taskInput.safeParse({ title: 'Task', [field]: 'x'.repeat(maximum + 1) }).success).toBe(false);
      expect(taskUpdate.safeParse({ [field]: 'x'.repeat(maximum) }).success).toBe(true);
      expect(taskUpdate.safeParse({ [field]: 'x'.repeat(maximum + 1) }).success).toBe(false);
    }
  });
  it('documents the same idea bound that runtime validation enforces', () => {
    expect(property('DescriptionIdea', 'input').maxLength).toBe(2000);
    expect(descriptionInput.safeParse({ input: 'x'.repeat(2000) }).success).toBe(true);
    expect(descriptionInput.safeParse({ input: 'x'.repeat(2001) }).success).toBe(false);
    expect(property('DescriptionSuggestion', 'description').maxLength).toBe(10000);
    expect(property('TaskSummary', 'summary').maxLength).toBe(4000);
  });
  it('keeps summary validation restricted to project/task UUIDs', () => {
    const input = { projectId: '12345678-1234-4234-8234-123456789abc', taskId: '22345678-1234-4234-8234-123456789abc' };
    expect(summaryInput.safeParse(input).success).toBe(true);
    expect(summaryInput.safeParse({ ...input, taskId: 'invalid' }).success).toBe(false);
    expect(summaryInput.safeParse({ ...input, description: 'Override' }).success).toBe(false);
  });
  it('publishes the database notification types and supported attachment formats', () => {
    expect(property('Notification', 'type').enum).toEqual(Object.values(NotificationType));
    expect(property('Attachment', 'size').maximum).toBe(10 * 1024 * 1024);
    const mediaTypes = property('Attachment', 'mimeType').enum;
    expect(mediaTypes).toEqual(['application/pdf', 'image/png', 'image/jpeg']);
    for (const [filename, mediaType] of [
      ['file.pdf', 'application/pdf'], ['file.png', 'image/png'],
      ['file.jpg', 'image/jpeg'], ['file.jpeg', 'image/jpeg'],
    ]) {
      expect(mediaTypes).toContain(mediaType);
      expect(() => validateFileName(filename, mediaType)).not.toThrow();
    }
    expect(() => validateFileName('file.txt', 'text/plain')).toThrow();
  });
});
