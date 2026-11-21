import nodemailer from 'nodemailer';
import { config } from '../config.js';

/** Send recovery tokens only through SMTP; disable message and protocol logging. */
export async function sendResetEmail(email: string, token: string) {
  const localRelay = ['localhost', '127.0.0.1', 'mailpit'].includes(config.SMTP_HOST);
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE,
    requireTLS: config.NODE_ENV === 'production' && !localRelay && !config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000,
    logger: false, debug: false,
  });
  try {
    await transport.sendMail({
      from: config.SMTP_FROM, to: email, subject: 'Reset your Task Management password',
      text: `A password reset was requested for your account.\n\nYour single-use reset token is:\n${token}\n\nIt expires after 15 minutes. Submit it with your new password to POST /api/v1/auth/reset-password.\nIf you did not request this, ignore this email.`,
      disableFileAccess: true, disableUrlAccess: true,
    });
  } finally { transport.close(); }
}
