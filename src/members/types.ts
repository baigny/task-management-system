import type { Prisma } from '@prisma/client';
import type { publicUser } from '../auth/types.js';

export type MemberRole = 'OWNER' | 'MEMBER';
export type ProjectMember = Prisma.MembershipGetPayload<{ include: { user: { select: typeof publicUser } } }> & { role: MemberRole };
