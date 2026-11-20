import { randomUUID } from 'node:crypto';
import { db } from '../../src/db.js';
import { createSession } from '../../src/auth/service.js';

/** Create independent accounts without coupling collaboration tests to login rate limits. */
export async function accounts(count = 3) {
  const users = [];
  for (let index = 0; index < count; index++) {
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.com`, name: `Member ${index}`, passwordHash: 'fixture-not-used-for-login' } });
    users.push({ ...user, ...await createSession(user) });
  }
  return users;
}

/** Remove only this suite's projects and accounts from the explicitly isolated database. */
export async function cleanup(userIds: string[]) {
  await db.project.deleteMany({ where: { ownerId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
}
