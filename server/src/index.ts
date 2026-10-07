import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { connectMongo } from './db/mongo.js';
import { createAuth } from './modules/auth/auth.js';
import { registerAuthRoutes } from './modules/auth/auth.route.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function start() {
  const uri = requiredEnv('DATABASE_URL');
  const secret = requiredEnv('BETTER_AUTH_SECRET');
  const baseURL = requiredEnv('BETTER_AUTH_URL');
  const { client, db } = await connectMongo(uri);
  const app = buildApp();
  app.addHook('onClose', async () => { await client.close(); });

  try {
    registerAuthRoutes(app, createAuth(db, secret, baseURL), baseURL);
    await app.listen({ port: 3000, host: '127.0.0.1' });
  } catch (error) {
    await app.close();
    throw error;
  }

  const shutdown = async () => {
    try { await app.close(); }
    catch (error) { app.log.error(error); process.exitCode = 1; }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
