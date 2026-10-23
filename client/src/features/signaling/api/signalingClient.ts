export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
import * as z from "zod";

export const rtcSignalSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("offer"), sdp: z.string().min(1).max(24000) }).strict(),
    z.object({ type: z.literal("answer"), sdp: z.string().min(1).max(24000) }).strict(),
    z.object({
        type: z.literal("ice-candidate"),
        candidate: z.object({
            candidate: z.string().max(2048),
            sdpMid: z.string().max(256).nullable().optional(),
            sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
            usernameFragment: z.string().max(256).nullable().optional(),
        }).strict(),
    }).strict(),
]);
export type RtcSignal = z.infer<typeof rtcSignalSchema>;

export type ClientMessage = | { type: "end-pair"; pairId: string } | { type: "webrtc-signal"; pairId: string; signal: RtcSignal }
    | {
        type: "create-invitation";
        recipientUserId: string;
    }
    | {
        type: "accept-invitation";
        invitationId: string;
    }
    | {
        type: "peer-message";
        pairId: string;
        text: string;
    };

type Handlers = {
  onStatus: (status: ConnectionStatus) => void;
  onMessage: (message: ServerMessage) => void;
  onError: (message: string) => void;
};

export function connectSignaling(handlers: Handlers) {
  const url = new URL('/api/signaling', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  let disposed = false;

  handlers.onStatus('connecting');
  socket.addEventListener('open', () => {
    if (!disposed) handlers.onStatus('connected');
  });
  socket.addEventListener("message", (event) => {
      if (disposed) return;

      if (typeof event.data !== "string") {
          handlers.onError("Unexpected binary response.");
          return;
      }

      let message: unknown;

      try {
          message = JSON.parse(event.data);
      } catch {
          handlers.onError("The server returned invalid JSON.");
          return;
      }

      const result = serverMessageSchema.safeParse(message);

      if (!result.success) {
          handlers.onError("The server returned an invalid message.");
          return;
      }

      handlers.onMessage(result.data);
  });
  socket.addEventListener('error', () => {
    if (!disposed) handlers.onError('WebSocket connection failed.');
  });
  socket.addEventListener('close', () => {
    if (!disposed) handlers.onStatus('disconnected');
  });

  return {
    send(message: ClientMessage): boolean {
        if (disposed || socket.readyState !== WebSocket.OPEN) {
            return false;
        }

        socket.send(JSON.stringify(message));
        return true;
    },
    close() {
      disposed = true;
      socket.close();
    },
  };
}
const serverMessageSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("webrtc-signal"), pairId: z.string().uuid(), signal: rtcSignalSchema }),
    z.object({
        type: z.literal("invitation-created"),
        invitationId: z.string().uuid(),
        recipientUserId: z.string(),
        expiresAt: z.number(),
    }),
    z.object({
        type: z.literal("invitation-received"),
        invitationId: z.string().uuid(),
        senderUserId: z.string(),
        expiresAt: z.number(),
    }),
    z.object({
        type: z.literal("invitation-accepted"),
        invitationId: z.string().uuid(),
        pairId: z.string().uuid(),
        role: z.enum(["sender", "receiver"]),
        peer: z.object({ id: z.string().min(1).max(128), name: z.string().max(100) }),
    }),
    z.object({
        type: z.literal("invitation-accepted-elsewhere"),
        invitationId: z.string().uuid(),
    }),
    z.object({
        type: z.literal("peer-message"),
        pairId: z.string().uuid(),
        text: z.string().min(1).max(200),
    }),
    z.object({
        type: z.literal("pair-ended"),
        pairId: z.string().uuid(),
        reason: z.literal("peer-disconnected"),
    }),
    z.object({
        type: z.literal("error"),
        text: z.string(),
    }),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;