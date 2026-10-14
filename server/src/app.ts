import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { registerSignalingGateway } from './modules/signaling/signaling.gateway.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(websocket, { options: { maxPayload: 1024 } });
  app.register(async (instance) => {
    registerSignalingGateway(instance);
  });

  // Liveness only; database readiness is a separate concern.
  app.get('/api/health', async () => ({ status: 'ok' }));
  return app;
}
