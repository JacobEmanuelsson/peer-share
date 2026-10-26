import { createHostedTurnLoader } from './turn.provider.js';
import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { createAuth } from './auth.js';

export function iceConfiguration(env: NodeJS.ProcessEnv, now = Date.now()) {
  const stun = (env.STUN_URLS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const turn = (env.TURN_URLS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (stun.some(url => !/^stuns?:[^\s]+$/.test(url)) || turn.some(url => !/^turns?:[^\s]+$/.test(url))) throw new Error('Invalid ICE URLs');
  if (turn.length && (!env.TURN_SHARED_SECRET || env.TURN_SHARED_SECRET.length < 32)) throw new Error('TURN_SHARED_SECRET must contain at least 32 characters');
  if (env.ICE_RELAY_ONLY === 'true' && !turn.length) throw new Error('Relay-only requires TURN');
  const expiresAt = Math.floor(now / 1000) + 3600;
  // Standard coturn TURN REST authentication; the shared secret never leaves the server.
  const username = expiresAt + ':' + randomUUID();
  const iceServers: { urls: string[]; username?: string; credential?: string }[] = [];
  if (stun.length) iceServers.push({ urls: stun });
  if (turn.length) iceServers.push({ urls: turn, username, credential: createHmac('sha1', env.TURN_SHARED_SECRET!).update(username).digest('base64') });
  return { iceServers, iceTransportPolicy: env.ICE_RELAY_ONLY === 'true' ? 'relay' as const : 'all' as const, expiresAt, relayAvailable: !!turn.length };
}
export function registerIceRoutes(parent: FastifyInstance, auth: ReturnType<typeof createAuth>, env: NodeJS.ProcessEnv, options: Parameters<typeof createHostedTurnLoader>[1] = {}) {
  const hosted = createHostedTurnLoader(env, options);
  iceConfiguration(hosted ? { ...env, ICE_RELAY_ONLY: 'false' } : env); // Validate before listening.
  parent.register(async app => {
    app.get('/api/ice', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true, disableRefresh: true } });
      if (!session || session.user.emailVerified !== true) return reply.code(401).send({ error: 'You must be signed in.' });
      if (!hosted) return iceConfiguration(env);
      try {
        const servers = await hosted();
        const base = iceConfiguration({ ...env, ICE_RELAY_ONLY: 'false' });
        return { ...base, iceServers: [...base.iceServers, ...servers], relayAvailable: true,
          iceTransportPolicy: env.ICE_RELAY_ONLY === 'true' ? 'relay' : 'all',
          // Config refresh time; provider credential expiry is managed by the provider.
          expiresAt: Math.floor(Date.now() / 1000) + 300 };
      } catch {
        app.log.warn('TURN provider unavailable');
        return reply.code(503).send({ error: 'Connection service is temporarily unavailable. Try again shortly.' });
      }
    });
  });
}
