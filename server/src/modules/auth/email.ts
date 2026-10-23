import nodemailer from 'nodemailer';

export type AccountMailer = (to: string, subject: string, url: string) => Promise<void>;
export function createAccountMailer(env: NodeJS.ProcessEnv): AccountMailer {
  if (env.NODE_ENV === 'production' && (!env.SMTP_HOST || !env.MAIL_FROM)) throw new Error('Configure SMTP_HOST and MAIL_FROM for account email');
  const host = env.SMTP_HOST ?? '127.0.0.1', port = Number(env.SMTP_PORT ?? 1025);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP_PORT');
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const transport = nodemailer.createTransport({
    host, port, secure: env.SMTP_SECURE === 'true', requireTLS: !local,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } } : {}),
    connectionTimeout: 10000, socketTimeout: 15000,
  });
  let pending = 0;
  return async (to, subject, url) => {
    if (pending >= 50) throw new Error('Account mail queue is busy');
    pending++;
    try { await transport.sendMail({ from: env.MAIL_FROM ?? 'Peer Share <noreply@localhost>', to, subject, text: subject + '\n\n' + url + '\n\nIf you did not request this, ignore this email.' }); }
    finally { pending--; }
  };
}