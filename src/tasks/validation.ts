import { TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { id, pagination } from '../validation.js';

const taskFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  dueDate: z.iso.datetime({ offset: true }).transform(value => new Date(value)).nullable().optional(),
  status: z.enum(TaskStatus),
  assigneeId: id.nullable().optional(),
};
export const taskInput = z.object({ ...taskFields, description: taskFields.description.default(''), status: taskFields.status.default(TaskStatus.OPEN) }).strict();
// Creation defaults must never reset fields omitted from a partial update.
export const taskUpdate = z.object(taskFields).partial().strict()
  .refine(value => Object.keys(value).length > 0, 'At least one task field is required');
export type TaskUpdate = z.output<typeof taskUpdate>;

export type TaskInput = z.output<typeof taskInput>;

export const taskListQuery = pagination.extend({
  status: z.enum(TaskStatus).optional(),
  assigneeId: z.union([id, z.enum(['me', 'unassigned'])]).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'dueDate', 'title', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
}).strict();
export const taskDiscoveryQuery = taskListQuery.extend({ projectId: id.optional() });
export type TaskListQuery = z.output<typeof taskListQuery>;
export type TaskDiscoveryQuery = z.output<typeof taskDiscoveryQuery>;
