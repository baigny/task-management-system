import 'dotenv/config';
import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'PostgreSQL URL required'),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('uploads'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SMTP_HOST: z.string().trim().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().email().default('noreply@taskmanagement.local'),
}).superRefine((value, context) => {
  // A long example value is still public knowledge and cannot secure JWT signatures.
  if (value.NODE_ENV === 'production' && /replace|example|placeholder|change.?me/i.test(value.JWT_SECRET)) {
    context.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'A randomly generated JWT secret is required in production' });
  }
  if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) {
    context.addIssue({ code: 'custom', path: ['SMTP_USER'], message: 'SMTP_USER and SMTP_PASSWORD must be supplied together' });
  }
});

/** Validate explicit inputs so tests do not have to mutate the process environment. */
export function parseEnvironment(input: Record<string, unknown>) {
  return environmentSchema.parse(input);
}

/** Fail at startup rather than accepting requests with incomplete configuration. */
export const config = parseEnvironment(process.env);
