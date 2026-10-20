import type { createAuth } from './modules/auth/auth.js';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { registerSignalingGateway } from './modules/signaling/signaling.gateway.js';

export function buildApp(auth: ReturnType<typeof createAuth>, allowedOrigin: string) {
  const app = Fastify({ logger: true });

  app.register(websocket, { options: { maxPayload: 1024 } });
  app.register(async (instance) => {
    registerSignalingGateway(instance, auth, allowedOrigin);
  });

  // Liveness only; database readiness is a separate concern.
  app.get('/api/health', async () => ({ status: 'ok' }));
  return app;
}
