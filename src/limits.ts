// Keep runtime validation, AI instructions, and the published API contract aligned.
export const MAX_TASK_TITLE_LENGTH = 200;
export const MAX_TASK_DESCRIPTION_LENGTH = 10_000;
export const MAX_AI_IDEA_LENGTH = 2000;
export const MAX_AI_SUMMARY_LENGTH = 4000;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ATTACHMENT_FORMATS: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};
