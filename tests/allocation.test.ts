import { describe, expect, it } from 'vitest';
import { allocateTasks } from '../src/members/allocation.js';

describe('automatic task allocation', () => {
  it('assigns zero-workload members first and recalculates after every assignment', () => {
    const result = allocateTasks(['t1', 't2', 't3', 't4', 't5'], [{ userId: 'b', activeTasks: 1 }, { userId: 'c', activeTasks: 0 }, { userId: 'a', activeTasks: 0 }]);
    expect(result.assignments.map(item => item.assigneeId)).toEqual(['a', 'c', 'a', 'b', 'c']);
    expect(result.allocations.map(item => item.resultingTasks)).toEqual([2, 2, 2]);
  });
  it('uses stable ID ties regardless of input order and preserves caller data', () => {
    const candidates = [{ userId: 'b', activeTasks: 0 }, { userId: 'a', activeTasks: 0 }];
    const original = structuredClone(candidates);
    const result = allocateTasks(['t1', 't2'], candidates);
    expect(result.assignments).toEqual([{ taskId: 't1', assigneeId: 'a' }, { taskId: 't2', assigneeId: 'b' }]);
    expect(candidates).toEqual(original);
  });
  it('keeps choosing the less-loaded member until workloads converge', () => {
    const result = allocateTasks(['t1', 't2', 't3'], [{ userId: 'a', activeTasks: 0 }, { userId: 'b', activeTasks: 5 }]);
    expect(result.assignments.every(item => item.assigneeId === 'a')).toBe(true);
  });
  it('supports a single manual replacement or owner fallback and empty task sets', () => {
    expect(allocateTasks(['t1', 't2'], [{ userId: 'owner', activeTasks: 4 }]).allocations).toEqual([{ userId: 'owner', currentTasks: 4, reassignedTasks: 2, resultingTasks: 6 }]);
    expect(allocateTasks([], [{ userId: 'owner', activeTasks: 4 }]).assignments).toEqual([]);
    expect(() => allocateTasks(['t1'], [])).toThrow('at least one candidate');
  });
});
