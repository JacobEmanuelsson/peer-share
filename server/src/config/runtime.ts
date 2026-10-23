import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  SERVE_CLIENT: z.enum(['true', 'false']).default('false'),
  BETTER_AUTH_URL: z.url(),
});

export function readRuntimeConfig(env: NodeJS.ProcessEnv) {
  const config = schema.parse({
    ...env,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL || env.RENDER_EXTERNAL_URL,
  });
  const url = new URL(config.BETTER_AUTH_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BETTER_AUTH_URL must be an HTTP(S) origin, without a path or credentials');
  }
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('Production BETTER_AUTH_URL must use HTTPS');
  }
  return {
    port: config.PORT,
    host: config.HOST,
    trustProxy: config.TRUST_PROXY_HOPS || false,
    serveClient: config.SERVE_CLIENT === 'true',
    baseURL: url.origin,
  } as const;
}