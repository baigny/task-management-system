import { type Project } from '@prisma/client';
import { inProject, type Transaction } from '../access.js';
import { recordActivities, recordActivity } from '../activity.js';
import { ApiError } from '../errors.js';
import { allocateTasks } from '../tasks/allocation.js';
import { automaticCandidates, loadWorkloads, unfinishedTaskWhere } from '../tasks/assignment.js';
import type { RemovalInput } from './validation.js';
import type { RemovalPreview } from './types.js';
import { notifyMembers } from '../notifications/write.js';

/** Validate removal rights and produce a current workload plan under the project lock. */
async function removalPlan(tx: Transaction, project: Project, actorId: string, targetId: string, input: RemovalInput) {
  if (actorId !== project.ownerId && actorId !== targetId) throw new ApiError(403, 'FORBIDDEN', 'Only the owner can remove other members');
  if (targetId === project.ownerId) throw new ApiError(409, 'OWNER_REQUIRED', 'Transfer ownership before leaving the project');
  if (input.mode === 'MANUAL' && actorId !== project.ownerId) throw new ApiError(403, 'FORBIDDEN', 'Only the owner can choose a replacement');
  const target = await tx.membership.findUnique({ where: { projectId_userId: { projectId: project.id, userId: targetId } }, select: { user: { select: { email: true } } } });
  if (!target) throw new ApiError(404, 'NOT_FOUND', 'Member not found');
  let candidates: { userId: string }[];
  if (input.mode === 'MANUAL') {
    const member = await tx.membership.findUnique({ where: { projectId_userId: { projectId: project.id, userId: input.replacementUserId } }, select: { userId: true } });
    if (!member || member.userId === targetId) throw new ApiError(400, 'INVALID_ASSIGNEE', 'Replacement must be a remaining project member');
    candidates = [member];
  } else candidates = await automaticCandidates(tx, project.id, project.ownerId, targetId);
  const active = unfinishedTaskWhere(project.id);
  const tasks = await tx.task.findMany({ where: { ...active, assigneeId: targetId }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const workloads = await loadWorkloads(tx, project.id, candidates);
  const plan = allocateTasks(tasks.map(task => task.id), workloads);
  const preview: RemovalPreview = { userId: targetId, mode: input.mode, unfinishedTasks: tasks.length, allocations: plan.allocations };
  return { ...plan, preview, targetEmail: target.user.email, active };
}

/** Preview allocation counts without removing membership or modifying any task. */
export function previewRemoval(projectId: string, actorId: string, targetId: string, input: RemovalInput): Promise<RemovalPreview> {
  return inProject(projectId, actorId, async (tx, project) => (await removalPlan(tx, project, actorId, targetId, input)).preview, { mode: 'read' });
}

/** Reassign unfinished tasks, revoke pending invitations, and remove membership atomically. */
export function removeMember(projectId: string, actorId: string, targetId: string, input: RemovalInput): Promise<RemovalPreview> {
  return inProject(projectId, actorId, async (tx, project) => {
    const plan = await removalPlan(tx, project, actorId, targetId, input);
    const groups = new Map<string, string[]>();
    for (const assignment of plan.assignments) {
      const ids = groups.get(assignment.assigneeId) ?? [];
      ids.push(assignment.taskId);
      groups.set(assignment.assigneeId, ids);
    }
    for (const [assigneeId, taskIds] of groups) {
      // Bound SQL parameters and group writes by recipient instead of updating one task at a time.
      for (let offset = 0; offset < taskIds.length; offset += 1000) {
        const ids = taskIds.slice(offset, offset + 1000);
        const updated = await tx.task.updateMany({ where: { ...plan.active, assigneeId: targetId, id: { in: ids } }, data: { assigneeId } });
        if (updated.count !== ids.length) throw new Error('Task assignments changed during member removal');
      }
    }
    await recordActivities(tx, plan.assignments.map(assignment => ({ projectId, actorId, action: 'TASK_REASSIGNED', entityId: assignment.taskId, taskId: assignment.taskId, metadata: { previousAssigneeId: targetId, assigneeId: assignment.assigneeId, reason: 'MEMBER_REMOVAL' } })));
    await tx.invitation.updateMany({ where: { projectId, email: plan.targetEmail, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.membership.delete({ where: { projectId_userId: { projectId, userId: targetId } } });
    await recordActivity(tx, projectId, actorId, actorId === targetId ? 'MEMBER_LEFT' : 'MEMBER_REMOVED', targetId, { mode: input.mode, reassignedTasks: plan.assignments.length });
    await notifyMembers(tx, projectId, actorId, plan.assignments.map(assignment => ({ taskId: assignment.taskId, userId: assignment.assigneeId, type: 'TASK_ASSIGNED', metadata: { reason: 'MEMBER_REMOVAL' } })));
    return plan.preview;
  });
}
