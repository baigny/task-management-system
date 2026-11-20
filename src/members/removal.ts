import { TaskStatus, type Prisma, type Project } from '@prisma/client';
import { inProject, type Transaction } from '../access.js';
import { recordActivities, recordActivity } from '../activity.js';
import { ApiError } from '../errors.js';
import { allocateTasks } from './allocation.js';
import type { RemovalInput } from './validation.js';
import type { RemovalPreview } from './types.js';

/** Validate removal rights and produce a current workload plan under the project lock. */
async function removalPlan(tx: Transaction, project: Project, actorId: string, targetId: string, input: RemovalInput) {
  if (actorId !== project.ownerId && actorId !== targetId) throw new ApiError(403, 'FORBIDDEN', 'Only the owner can remove other members');
  if (targetId === project.ownerId) throw new ApiError(409, 'OWNER_REQUIRED', 'Transfer ownership before leaving the project');
  if (input.mode === 'MANUAL' && actorId !== project.ownerId) throw new ApiError(403, 'FORBIDDEN', 'Only the owner can choose a replacement');
  const target = await tx.membership.findUnique({ where: { projectId_userId: { projectId: project.id, userId: targetId } }, select: { user: { select: { email: true } } } });
  if (!target) throw new ApiError(404, 'NOT_FOUND', 'Member not found');
  let candidates = await tx.membership.findMany({ where: { projectId: project.id, userId: { not: targetId } }, select: { userId: true } });
  if (input.mode === 'MANUAL') {
    candidates = candidates.filter(candidate => candidate.userId === input.replacementUserId);
    if (!candidates.length) throw new ApiError(400, 'INVALID_ASSIGNEE', 'Replacement must be a remaining project member');
  } else {
    // Keep the owner as the fallback when no other remaining members are available.
    const members = candidates.filter(candidate => candidate.userId !== project.ownerId);
    if (members.length) candidates = members;
  }
  const active: Prisma.TaskWhereInput = { projectId: project.id, deletedAt: null, status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS] } };
  const tasks = await tx.task.findMany({ where: { ...active, assigneeId: targetId }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const counts = await tx.task.groupBy({ by: ['assigneeId'], where: { ...active, assigneeId: { in: candidates.map(candidate => candidate.userId) } }, _count: { _all: true } });
  const workloads = new Map(counts.map(count => [count.assigneeId, count._count._all]));
  const plan = allocateTasks(tasks.map(task => task.id), candidates.map(candidate => ({ userId: candidate.userId, activeTasks: workloads.get(candidate.userId) ?? 0 })));
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
    await recordActivities(tx, plan.assignments.map(assignment => ({ projectId, actorId, action: 'TASK_REASSIGNED', entityId: assignment.taskId, metadata: { previousAssigneeId: targetId, assigneeId: assignment.assigneeId, reason: 'MEMBER_REMOVAL' } })));
    await tx.invitation.updateMany({ where: { projectId, email: plan.targetEmail, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.membership.delete({ where: { projectId_userId: { projectId, userId: targetId } } });
    await recordActivity(tx, projectId, actorId, actorId === targetId ? 'MEMBER_LEFT' : 'MEMBER_REMOVED', targetId, { mode: input.mode, reassignedTasks: plan.assignments.length });
    return plan.preview;
  });
}
