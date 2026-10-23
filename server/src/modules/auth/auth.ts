import { allowedOrigins } from './origins.js';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import type { Db } from 'mongodb';
import { createAccountMailer, type AccountMailer } from './email.js';

type Options = { sendMail?: AccountMailer; removeAccount?: (id: string) => Promise<void> };
export function createAuth(db: Db, secret: string, baseURL: string, options: Options = {}) {
  const sendMail = options.sendMail ?? createAccountMailer(process.env);
  // Delivery is awaited by Better Auth's background-task handler, without exposing
  // account existence through different password-recovery response times.
  return betterAuth({
    database: mongodbAdapter(db), secret, baseURL: process.env.PUBLIC_APP_URL ?? baseURL,
    trustedOrigins: allowedOrigins(baseURL),
    advanced: { backgroundTasks: { handler: promise => { void promise.catch(error => console.error('Account email delivery failed', error instanceof Error ? error.name : 'UnknownError')); } } },
    emailAndPassword: {
      enabled: true, requireEmailVerification: true, minPasswordLength: 8, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => sendMail(user.email, 'Reset your Peer Share password', url),
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false, expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) => sendMail(user.email, 'Verify your Peer Share email', url),
    },
    user: { deleteUser: {
      enabled: true,
      beforeDelete: async user => { await options.removeAccount?.(user.id); },
    } },
    rateLimit: {
      enabled: true, window: 60, max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
      },
    },
  });
}