import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { createAuth } from './auth.js';

type Auth = ReturnType<typeof createAuth>;
function authBucket(url: string) {
  let path = url.split('?')[0];
  try { path = decodeURIComponent(path).replace(/\/+$/, '').toLowerCase(); } catch { return 'other'; }
  if (path === '/api/auth/sign-up/email') return 'signup';
  if (path === '/api/auth/sign-in/email') return 'signin';
  if (path === '/api/auth/request-password-reset') return 'reset';
  if (path === '/api/auth/send-verification-email') return 'verify';
  return 'other';
}

export function registerAuthRoutes(parent: FastifyInstance, auth: Auth, baseURL: string) {
  parent.register(async app => {
    app.route({
      method: ['GET', 'POST'],
      url: '/api/auth/*',
      config: { rateLimit: {
        timeWindow: '1 minute',
        max: request => ({ signup: 5, reset: 3, verify: 3, signin: 10, other: 100 })[authBucket(request.url)],
        keyGenerator: request => request.ip + ':' + authBucket(request.url),
      } },
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
        reply.header("Cache-Control", "no-store");
        const session = await auth.api.getSession({
            headers: fromNodeHeaders(request.headers),
            query: { disableCookieCache: true, disableRefresh: true },
        });

        if (!session || session.user.emailVerified !== true) {
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
  });
}
