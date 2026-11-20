import type { Prisma } from '@prisma/client';
import type { publicUser } from '../auth/types.js';

export type MemberRole = 'OWNER' | 'MEMBER';
export type ProjectMember = Prisma.MembershipGetPayload<{ include: { user: { select: typeof publicUser } } }> & { role: MemberRole };

export type Workload = { userId: string; activeTasks: number };
export type Allocation = { userId: string; currentTasks: number; reassignedTasks: number; resultingTasks: number };
export type TaskAssignment = { taskId: string; assigneeId: string };
export type RemovalPreview = { userId: string; mode: 'AUTOMATIC' | 'MANUAL'; unfinishedTasks: number; allocations: Allocation[] };
