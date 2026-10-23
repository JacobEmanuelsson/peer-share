import * as z from 'zod';
const schema = z.object({
  iceServers: z.array(z.object({ urls: z.array(z.string()), username: z.string().optional(), credential: z.string().optional() })),
  iceTransportPolicy: z.enum(['all', 'relay']), expiresAt: z.number(), relayAvailable: z.boolean(),
});
export async function loadIceConfiguration(): Promise<RTCConfiguration> {
  const response = await fetch('/api/ice', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load connection configuration. Check your session and try again.');
  const config = schema.parse(await response.json());
  return { iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy };
}