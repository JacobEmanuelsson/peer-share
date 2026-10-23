import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { accessSync } from 'node:fs';
import { join } from 'node:path';

// Only the Vite build is public. Source files, .env and received files are never served.
export function registerClient(app: FastifyInstance, root: string) {
  accessSync(join(root, 'index.html'));
  app.register(fastifyStatic, {
    root: join(root, 'assets'), prefix: '/assets/',
    maxAge: '1y', immutable: true, dotfiles: 'deny', list: false,
  });
  app.get('/', (_request, reply) => reply.header('Cache-Control', 'no-store').sendFile('index.html', root, { cacheControl: false }));
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0];
    const navigation = ['GET', 'HEAD'].includes(request.method)
      && request.headers.accept?.includes('text/html')
      && path !== '/api' && !path.startsWith('/api/')
      && !path.startsWith('/assets/') && !path.includes('.');
    if (navigation) {
      return reply.header('Cache-Control', 'no-store').sendFile('index.html', root, { cacheControl: false });
    }
    return reply.code(404).send({ error: 'Not found' });
  });
}