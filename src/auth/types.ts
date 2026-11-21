import type { Prisma } from '@prisma/client';

export const publicUser = { id: true, email: true, name: true, createdAt: true } as const satisfies Prisma.UserSelect;
export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUser }>;
export type SessionResult = { token: string; expiresAt: Date };
export type AuthResult = SessionResult & { user: PublicUser };
export type AuthContext = { userId: string; sessionId: string; expiresAt: Date };
