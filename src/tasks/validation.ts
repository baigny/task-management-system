import { TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { id } from '../validation.js';

export const taskInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).default(''),
  dueDate: z.iso.datetime({ offset: true }).transform(value => new Date(value)).nullable().optional(),
  status: z.enum(TaskStatus).default(TaskStatus.OPEN),
  assigneeId: id.nullable().optional(),
}).strict();

export type TaskInput = z.output<typeof taskInput>;
