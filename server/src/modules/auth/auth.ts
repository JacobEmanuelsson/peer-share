import { betterAuth } from 'better-auth';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import type { Db } from 'mongodb';

export function createAuth(db: Db, secret: string, baseURL: string) {
  return betterAuth({
    database: mongodbAdapter(db),
    secret,
    baseURL,
    trustedOrigins: [new URL(baseURL).origin],
    emailAndPassword: { enabled: true },
  });
}
