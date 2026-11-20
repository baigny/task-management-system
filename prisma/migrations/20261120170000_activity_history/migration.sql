ALTER TABLE "Activity" ADD COLUMN "taskId" TEXT;
CREATE INDEX "Activity_projectId_taskId_createdAt_id_idx" ON "Activity"("projectId", "taskId", "createdAt", "id");
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Associate existing events only with tasks still present in their original project.
UPDATE "Activity" a SET "taskId" = t.id FROM "Task" t
WHERE a."projectId" = t."projectId" AND (
  (a.action IN ('TASK_CREATED', 'TASK_UPDATED', 'TASK_REASSIGNED', 'TASK_DELETED', 'TASK_RESTORED') AND a."entityId" = t.id)
  OR a.metadata->>'taskId' = t.id
);
