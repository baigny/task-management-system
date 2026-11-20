import type { Allocation } from '../tasks/types.js';
import type { Prisma } from '@prisma/client';
import type { publicUser } from '../auth/types.js';

export type MemberRole = 'OWNER' | 'MEMBER';
export type ProjectMember = Prisma.MembershipGetPayload<{ include: { user: { select: typeof publicUser } } }> & { role: MemberRole };

export type RemovalPreview = { userId: string; mode: 'AUTOMATIC' | 'MANUAL'; unfinishedTasks: number; allocations: Allocation[] };
