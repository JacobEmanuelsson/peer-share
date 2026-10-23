import rateLimit from '@fastify/rate-limit';
import type { SocialService } from './modules/social/social.service.js';
import { registerGroupGateway } from './modules/social/group.gateway.js';
import type { createAuth } from './modules/auth/auth.js';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { registerSignalingGateway } from './modules/signaling/signaling.gateway.js';

export function buildApp(auth: ReturnType<typeof createAuth>, allowedOrigin: string, social?: SocialService, options: { trustProxy?: number | false } = {}) {
  const app = Fastify({
    bodyLimit: 32 * 1024,
    trustProxy: options.trustProxy ? (_address, hop) => hop < Number(options.trustProxy) : false,
    logger: {
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie'],
      serializers: { req: request => ({
        method: request.method,
        url: request.url?.split('?')[0].replace(/\/reset-password\/[^/]+/, '/reset-password/[redacted]'),
        hostname: request.hostname, remoteAddress: request.ip,
      }) },
    },
  });
  app.server.maxConnections = 1000;

  app.register(rateLimit, { max: 240, timeWindow: '1 minute', cache: 10000 });
  app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  app.register(async (instance) => {
    registerSignalingGateway(instance, auth, allowedOrigin, social);
    if (social) registerGroupGateway(instance, auth, social, allowedOrigin);
  });

  // Liveness only; database readiness is a separate concern.
  app.register(async instance => { instance.get('/api/health', async () => ({ status: 'ok' })); });
  return app;
}
