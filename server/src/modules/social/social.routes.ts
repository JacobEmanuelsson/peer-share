import { isAllowedOrigin } from '../auth/origins.js';
import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import * as z from 'zod';
import type { createAuth } from '../auth/auth.js';
import type { SocialService } from './social.service.js';

const idParams = z.object({ id: z.string().uuid() });
const requestSchema = z.object({ recipientId: z.string().trim().min(1).max(128) }).strict();
const groupSchema = z.object({ name: z.string().trim().min(1).max(60), memberIds: z.array(z.string().min(1).max(128)).min(1).max(5) }).strict();

export async function registerSocialRoutes(app: FastifyInstance, auth: ReturnType<typeof createAuth>, service: SocialService, origin: string) {
  app.addHook('preValidation', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.method !== 'GET' && !isAllowedOrigin(request.headers.origin, origin)) return reply.code(403).send({ error: 'Origin is not allowed.' });
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true, disableRefresh: true } });
    if (!session || session.user.emailVerified !== true) return reply.code(401).send({ error: 'You must be signed in.' });
    // Per-request identity; never accept an actor ID supplied in the body.
    request.socialUserId = session.user.id;
  });
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request.' });
    const code = error.statusCode ?? 500;
    if (code >= 500) app.log.error(error);
    return reply.code(code).send({ error: code >= 500 ? 'Could not complete request.' : error.message });
  });
  app.post('/api/blocks', async (request, reply) => { await service.block(request.socialUserId!, requestSchema.parse(request.body).recipientId); return reply.code(201).send({ ok: true }); });
  app.delete<{ Params: { id: string } }>('/api/blocks/:id', async request => {
    await service.unblock(request.socialUserId!, z.string().min(1).max(128).parse(request.params.id)); return { ok: true };
  });
  app.get('/api/social', async request => service.list(request.socialUserId!));
  app.post('/api/friends', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: request => request.socialUserId ?? request.ip } } }, async (request, reply) => {
    await service.requestFriend(request.socialUserId!, requestSchema.parse(request.body).recipientId);
    return reply.code(201).send({ ok: true });
  });
  app.post('/api/friends/:id/accept', async request => { await service.acceptFriend(request.socialUserId!, idParams.parse(request.params).id); return { ok: true }; });
  app.delete('/api/friends/:id', async request => { await service.removeFriend(request.socialUserId!, idParams.parse(request.params).id); return { ok: true }; });
  app.post('/api/groups', async (request, reply) => {
    const input = groupSchema.parse(request.body);
    return reply.code(201).send(await service.createGroup(request.socialUserId!, input.name, input.memberIds));
  });
  app.delete('/api/groups/:id', async request => { await service.deleteGroup(request.socialUserId!, idParams.parse(request.params).id); return { ok: true }; });
  app.post('/api/groups/:id/leave', async request => { await service.leaveGroup(request.socialUserId!, idParams.parse(request.params).id); return { ok: true }; });
}
declare module 'fastify' { interface FastifyRequest { socialUserId?: string } }