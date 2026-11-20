import { db } from '../db.js';

/** Create the project and its owner's membership atomically. */
export function createProject(userId: string, input: { name: string; description: string }) {
  return db.project.create({ data: { ...input, ownerId: userId, memberships: { create: { userId } } } });
}

