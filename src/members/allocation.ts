import type { Allocation, TaskAssignment, Workload } from './types.js';

/** Balance tasks by current workload with stable user-ID ties, without mutating caller inputs. */
export function allocateTasks(taskIds: readonly string[], candidates: readonly Workload[]) {
  if (!candidates.length) throw new Error('Reassignment requires at least one candidate');
  const allocations: Allocation[] = candidates.map(candidate => ({ userId: candidate.userId, currentTasks: candidate.activeTasks, reassignedTasks: 0, resultingTasks: candidate.activeTasks }));
  const assignments: TaskAssignment[] = [];
  for (const taskId of taskIds) {
    // A linear minimum avoids sorting the member list repeatedly for each task.
    const next = allocations.reduce((best, current) => current.resultingTasks < best.resultingTasks
      || (current.resultingTasks === best.resultingTasks && current.userId < best.userId) ? current : best);
    next.reassignedTasks++;
    next.resultingTasks++;
    assignments.push({ taskId, assigneeId: next.userId });
  }
  allocations.sort((left, right) => left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0);
  return { assignments, allocations };
}
