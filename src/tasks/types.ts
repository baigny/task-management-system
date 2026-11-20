export type Workload = { userId: string; activeTasks: number };
export type Allocation = { userId: string; currentTasks: number; reassignedTasks: number; resultingTasks: number };
export type TaskAssignment = { taskId: string; assigneeId: string };
