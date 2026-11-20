import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
/** Authenticate invitation requests with the selected fixture account. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Create an isolated project for an invitation scenario. */
async function project() {
  return db.project.create({ data: { name: 'Invitations', ownerId: users[0].id, memberships: { create: { userId: users[0].id } } } });
}
/** Issue an invitation through the same public endpoint used by project owners. */
async function invite(projectId: string, index = 1) {
  return (await request(app).post(`/api/v1/projects/${projectId}/invitations`).set(auth()).send({ email: users[index].email }).expect(201)).body as { invitation: { id: string }; token: string };
}
/** Submit a token as the invited fixture account. */
const accept = (token: string, index = 1) => request(app).post('/api/v1/invitations/accept').set(auth(index)).send({ token });

describe('project invitations', () => {
  beforeAll(async () => { users = await accounts(3); });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });
  it('issues hashed secrets and restricts invitation management to the owner', async () => {
    const team = await project();
    await db.membership.create({ data: { projectId: team.id, userId: users[2].id } });
    const issued = await invite(team.id);
    expect(issued.token).toMatch(/^[a-f0-9]{64}$/);
    const stored = await db.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } });
    expect(stored.tokenHash).not.toBe(issued.token);
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    const list = await request(app).get(`/api/v1/projects/${team.id}/invitations`).set(auth()).expect(200);
    expect(list.body.total).toBe(1);
    expect(JSON.stringify(list.body)).not.toContain(stored.tokenHash);
    expect(JSON.stringify(list.body)).not.toContain(issued.token);
    await request(app).get(`/api/v1/projects/${team.id}/invitations`).set(auth(2)).expect(403);
    await request(app).post(`/api/v1/projects/${team.id}/invitations`).set(auth(2)).send({ email: users[1].email }).expect(403);
    await request(app).get(`/api/v1/projects/${team.id}/invitations`).set(auth(1)).expect(404);
    await request(app).post(`/api/v1/projects/${team.id}/invitations`).set(auth()).send({ email: users[0].email }).expect(409);
  });
  it('binds tokens to email, consumes them once, and never promotes a member to owner', async () => {
    const team = await project();
    const issued = await invite(team.id);
    await accept(issued.token, 2).expect(400);
    const joined = await accept(issued.token).expect(200);
    expect(joined.body.ownerId).toBe(users[0].id);
    expect(await db.membership.count({ where: { projectId: team.id, userId: users[1].id } })).toBe(1);
    await accept(issued.token).expect(400);
    await request(app).delete(`/api/v1/projects/${team.id}/invitations/${issued.invitation.id}`).set(auth()).expect(409);
    expect(await db.activity.count({ where: { projectId: team.id, action: 'MEMBER_JOINED' } })).toBe(1);
  });
  it('rejects expired, revoked, and replaced tokens', async () => {
    const team = await project();
    const expired = await invite(team.id);
    await db.invitation.update({ where: { id: expired.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await accept(expired.token).expect(400);
    const revoked = await invite(team.id);
    await request(app).delete(`/api/v1/projects/${team.id}/invitations/${revoked.invitation.id}`).set(auth()).expect(204);
    await accept(revoked.token).expect(400);
    const replaced = await invite(team.id);
    const current = await invite(team.id);
    await accept(replaced.token).expect(400);
    await accept(current.token).expect(200);
  });
  it('serializes concurrent acceptance without duplicate memberships', async () => {
    const team = await project();
    const issued = await invite(team.id);
    const results = await Promise.all([accept(issued.token), accept(issued.token)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 400]);
    expect(await db.membership.count({ where: { projectId: team.id } })).toBe(2);
  });
  it('prevents joining deleted projects and cascades invitations on permanent deletion', async () => {
    const team = await project();
    const issued = await invite(team.id);
    await request(app).delete(`/api/v1/projects/${team.id}`).set(auth()).expect(204);
    await accept(issued.token).expect(400);
    await request(app).post(`/api/v1/projects/${team.id}/invitations`).set(auth()).send({ email: users[2].email }).expect(404);
    await request(app).delete(`/api/v1/projects/${team.id}/permanent`).set(auth()).expect(204);
    expect(await db.invitation.count({ where: { projectId: team.id } })).toBe(0);
    await accept(issued.token).expect(400);
  });
  it('validates invitation input and conceals records from other projects', async () => {
    const first = await project();
    const second = await project();
    const issued = await invite(first.id);
    await request(app).delete(`/api/v1/projects/${second.id}/invitations/${issued.invitation.id}`).set(auth()).expect(404);
    await request(app).post(`/api/v1/projects/${first.id}/invitations`).set(auth()).send({ email: 'invalid' }).expect(400);
    await request(app).post('/api/v1/invitations/accept').send({ token: issued.token }).expect(401);
    await accept('invalid').expect(400);
    await accept('a'.repeat(64)).expect(400);
  });
});
