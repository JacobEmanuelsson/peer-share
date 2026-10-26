import { z } from 'zod';

const iceUrl = z.string().min(1).max(2048).regex(/^(?:stun|stuns|turn|turns):[^\s]+$/);
const serverSchema = z.object({
  urls: z.union([iceUrl, z.array(iceUrl).min(1).max(8)]),
  username: z.string().min(1).max(1024).optional(),
  credential: z.string().min(1).max(1024).optional(),
}).transform(server => ({ ...server, urls: typeof server.urls === 'string' ? [server.urls] : server.urls }));
const responseSchema = z.array(serverSchema).min(1).max(12).refine(servers =>
  servers.some(server => server.urls.some(url => /^turns?:/.test(url)))
  && servers.every(server => !server.urls.some(url => /^turns?:/.test(url)) || (server.username && server.credential)),
);
export type HostedIceServer = z.infer<typeof serverSchema>;

// Provider keys stay on the backend. Browsers receive only the ICE credentials.
export function createHostedTurnLoader(env: NodeJS.ProcessEnv, options: { request?: typeof fetch; clock?: () => number } = {}) {
  const app = env.METERED_APP_NAME?.trim(), key = env.METERED_TURN_API_KEY?.trim();
  if (!app && !key) return null;
  if (!app || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(app) || !key || key.length > 1024) {
    throw new Error('Configure METERED_APP_NAME and METERED_TURN_API_KEY');
  }
  if (env.TURN_URLS?.trim() || env.TURN_SHARED_SECRET?.trim()) throw new Error('Choose either hosted TURN or coturn, not both');
  const url = new URL(`https://${app}.metered.live/api/v1/turn/credentials`);
  url.searchParams.set('apiKey', key);
  const request = options.request ?? fetch, clock = options.clock ?? Date.now;
  let cached: { servers: HostedIceServer[]; refreshAt: number } | undefined;
  let pending: Promise<HostedIceServer[]> | undefined;
  async function load() {
    try {
      const response = await request(url, { signal: AbortSignal.timeout(5000), redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Provider rejected request');
      const body = await response.text();
      if (body.length > 64 * 1024) throw new Error('Provider response too large');
      const servers = responseSchema.parse(JSON.parse(body));
      cached = { servers, refreshAt: clock() + 5 * 60 * 1000 };
      return servers;
    } catch {
      // Provider request URLs contain the key. Do not expose them, bodies or errors.
      throw new Error('TURN provider unavailable');
    }
  }
  return () => {
    if (cached && cached.refreshAt > clock()) return Promise.resolve(cached.servers);
    pending ??= load().finally(() => { pending = undefined; });
    return pending;
  };
}