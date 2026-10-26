import { isAllowedOrigin } from '../auth/origins.js';
import { createBudget } from '../signaling/abuse.js';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import WebSocket from 'ws';
import * as z from 'zod';
import { createMessageQueue } from '../signaling/signaling.queue.js';
import type { createAuth } from '../auth/auth.js';
import type { SocialService } from './social.service.js';

const signalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(24000) }).strict(),
  z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(24000) }).strict(),
  z.object({ type: z.literal('ice-candidate'), candidate: z.object({
    candidate: z.string().max(2048), sdpMid: z.string().max(256).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }).strict() }).strict(),
]);
const messageSchema = z.object({ type: z.literal('signal'), to: z.string().uuid(), signal: signalSchema }).strict();
type Member = { id: string; userId: string; name: string; socket: WebSocket; verify: () => Promise<boolean> };

export function registerGroupGateway(app: FastifyInstance, auth: ReturnType<typeof createAuth>, service: SocialService, origin: string) {
  const allowed = createBudget(240, 60_000);
  const rooms = new Map<string, Map<string, Member>>();
  const departed = new WeakMap<Map<string, Member>, Set<string>>();
  function rememberDeparted(room: Map<string, Member>, id: string) {
    const ids = departed.get(room) ?? new Set<string>();
    ids.add(id);
    while (ids.size > 256) ids.delete(ids.values().next().value!);
    departed.set(room, ids);
  }
  function roster(room: Map<string, Member>) {
    for (const member of room.values()) if (member.socket.readyState === WebSocket.OPEN) member.socket.send(JSON.stringify({
      type: 'roster', selfId: member.id,
      peers: [...room.values()].filter(other => other !== member && other.socket.readyState === WebSocket.OPEN).map(({ id, userId, name }) => ({ id, userId, name })),
    }));
  }
  const stopAccess = service.onUserAccessChanged(ids => {
    for (const room of rooms.values()) for (const member of room.values()) if (ids.includes(member.userId)) member.socket.close(1008, 'Account access changed');
  });
  const unsubscribe = service.onGroupAccessChanged(({ groupId, userId }) => {
    const room = rooms.get(groupId);
    if (!room) return;
    for (const [id, member] of room) if (!userId || member.userId === userId) {
      rememberDeparted(room, id); room.delete(id); member.socket.close(1008, 'Group membership ended');
    }
    if (room.size) roster(room); else if (rooms.get(groupId) === room) rooms.delete(groupId);
  });
  app.addHook('onClose', async () => { unsubscribe(); stopAccess(); });
  app.get<{ Params: { id: string } }>('/api/groups/:id/signaling', {
    websocket: true,
    preValidation: async (request, reply) => {
      if (!isAllowedOrigin(request.headers.origin, origin)) return reply.code(403).send({ error: 'Origin is not allowed.' });
      if (!z.string().uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'Invalid group.' });
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true, disableRefresh: true } });
      if (!session || session.user.emailVerified !== true) return reply.code(401).send({ error: 'You must be signed in.' });
      const group = await service.groupForMember(request.params.id, session.user.id);
      for (const userId of group.memberIds) if (userId !== session.user.id && !(await service.canConnect(session.user.id, userId))) return reply.code(403).send({ error: 'This group includes a blocked account.' });
      request.groupIdentity = { userId: session.user.id, sessionId: session.session.id, name: session.user.name };
    },
  }, (socket, request) => {
    const identity = request.groupIdentity!;
    const groupId = request.params.id, headers = fromNodeHeaders(request.headers);
    if ([...rooms.values()].flatMap(room => [...room.values()]).filter(member => member.userId === identity.userId && member.socket.readyState === WebSocket.OPEN).length >= 5) { socket.close(1008, 'Too many group connections'); return; }
    const room = rooms.get(groupId) ?? new Map<string, Member>();
    if ([...room.values()].some(member => member.userId === identity.userId && member.socket.readyState === WebSocket.OPEN) || room.size >= 6) {
      socket.close(1008, 'Group already joined on another tab or full'); return;
    }
    const id = randomUUID();
    async function verify() {
      if (socket.readyState !== WebSocket.OPEN) return false;
      try {
        const session = await auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
        if (!session || session.user.emailVerified !== true || session.user.id !== identity.userId || session.session.id !== identity.sessionId) throw new Error('Invalid session');
        await service.groupForMember(groupId, identity.userId);
        return socket.readyState === WebSocket.OPEN;
      } catch { socket.close(1008, 'Session or group membership ended'); return false; }
    }
    const member: Member = { id, userId: identity.userId, name: identity.name.slice(0, 100), socket, verify };
    room.set(id, member); rooms.set(groupId, room); roster(room);
    const queue = createMessageQueue({
      maxBytes: 256 * 1024,
      process: async (data, binary) => {
        if (!(await verify())) return;
        if (binary) { socket.close(1003, 'Text signaling only'); return; }
        const message = messageSchema.parse(JSON.parse(data.toString()));
        const target = room.get(message.to);
        // Queued ICE/SDP for a just-departed peer is normal during reconnect.
        // Unknown or cross-group IDs still follow the invalid-recipient path.
        if (!target && departed.get(room)?.has(message.to)) return;
        if (!target || target === member) { socket.close(1008, 'Invalid recipient'); return; }
        if (!(await service.canConnect(identity.userId, target.userId))) { socket.close(1008, 'Connection unavailable'); return; }
        const initiator = id < target.id;
        if ((message.signal.type === 'offer' && !initiator) || (message.signal.type === 'answer' && initiator)) { socket.close(1008, 'Invalid description role'); return; }
        if (!(await target.verify())) return;
        if (room.get(id) !== member || room.get(target.id) !== target || socket.readyState !== WebSocket.OPEN || target.socket.readyState !== WebSocket.OPEN) return;
        target.socket.send(JSON.stringify({ type: 'signal', from: id, signal: message.signal }));
      },
      onOverflow: () => socket.close(1008, 'Signaling queue limit exceeded'),
      onError: () => socket.close(1008, 'Invalid signaling message'),
    });
    socket.on('message', (data, binary) => { if (!allowed(identity.userId)) { socket.close(1008, 'Signaling rate limit exceeded'); return; } queue.enqueue(data, binary); });
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return; checking = true;
      try { await verify(); } finally { checking = false; }
    }, 15_000);
    timer.unref();
    socket.on('close', () => {
      queue.close(); clearInterval(timer); rememberDeparted(room, id); room.delete(id);
      if (!room.size) { if (rooms.get(groupId) === room) rooms.delete(groupId); } else roster(room);
    });
    socket.on('error', () => { queue.close(); socket.close(1011, 'Connection error'); });
  });
}
declare module 'fastify' { interface FastifyRequest { groupIdentity?: { userId: string; sessionId: string; name: string } } }