import { readRuntimeConfig } from './config/runtime.js';
import { registerClient } from './http/client.js';
import { registerIceRoutes } from './modules/auth/ice.js';
import { createSocialRepository } from './modules/social/social.repository.js';
import { createSocialService } from './modules/social/social.service.js';
import { registerSocialRoutes } from './modules/social/social.routes.js';
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
  const config = readRuntimeConfig(process.env);
  const baseURL = config.baseURL;
  const allowedOrigin = new URL(baseURL).origin;
  const { client, db } = await connectMongo(uri);

  const socialRepo = createSocialRepository(db);
  await socialRepo.init();
  const social = createSocialService(socialRepo);
  const auth = createAuth(db, secret, baseURL, { removeAccount: id => social.removeAccount(id) });
  const app = buildApp(auth, allowedOrigin, social, { trustProxy: config.trustProxy });
  registerIceRoutes(app, auth, process.env);
  app.register(async instance => registerSocialRoutes(instance, auth, social, allowedOrigin));
  app.addHook('onClose', async () => { await client.close(); });

  try {
    registerAuthRoutes(app, auth, baseURL);
    if (config.serveClient) registerClient(app, fileURLToPath(new URL('../../client/dist/', import.meta.url)));
    await app.listen({ port: config.port, host: config.host });
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
