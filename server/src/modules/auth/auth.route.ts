import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { createAuth } from './auth.js';

type Auth = ReturnType<typeof createAuth>;

export function registerAuthRoutes(app: FastifyInstance, auth: Auth, baseURL: string) {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const response = await auth.handler(new Request(new URL(request.url, baseURL), {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      }));

      reply.code(response.status);
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() !== 'set-cookie') reply.header(name, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(await response.text());
    },
  });
  app.get("/api/me", async (request, reply) => {
      const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
      });

      if (!session) {
          return reply.code(401).send({
              error: "You must be signed in.",
          });
      }

      return {
          user: {
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
          },
      };
  });
}
