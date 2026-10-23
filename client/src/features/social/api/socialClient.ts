import * as z from 'zod';
const profile = z.object({ id: z.string(), name: z.string() });
export const socialSchema = z.object({
  blocks: z.array(profile).default([]),
  friends: z.array(z.object({ id: z.string().uuid(), status: z.enum(['pending', 'accepted']), incoming: z.boolean(), peer: profile })),
  groups: z.array(z.object({ id: z.string().uuid(), name: z.string(), ownerId: z.string(), members: z.array(profile) })),
});
export type SocialData = z.infer<typeof socialSchema>;
export async function socialRequest(path: string, method = 'GET', body?: object, signal?: AbortSignal) {
  const response = await fetch(path, {
    method, signal, credentials: 'same-origin', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(z.object({ error: z.string() }).safeParse(data).data?.error ?? 'Could not complete request.');
  return data;
}