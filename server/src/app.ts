import Fastify from 'fastify';

// Building the app separately from listening makes future integration tests easier.
export function buildApp() {
  const app = Fastify({ logger: true });

  // Liveness only: this does not check MongoDB or claim database readiness.
  app.get('/api/health', async () => ({ status: 'ok' }));

  return app;
}
