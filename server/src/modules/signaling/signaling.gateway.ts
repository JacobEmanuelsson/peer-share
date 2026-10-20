import { createInvitationStore } from './signaling.invitations.js';
import { fromNodeHeaders } from 'better-auth/node';
import type { createAuth } from '../auth/auth.js';
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createConnectionRegistry } from "./signaling.connections.js";
import { randomBytes, randomUUID } from "node:crypto";
import * as z from "zod";
import WebSocket, { type RawData } from "ws";

type Room = {
    members: Set<WebSocket>;
    invitationToken: string;
};

const messageCheck = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("accept-invitation"),
        invitationId: z.string().uuid(),
    }).strict(),
    z.object({
        type: z.literal("create-invitation"),
        recipientUserId: z.string().trim().min(1).max(128),
    }).strict(),
    z.object({ type: z.literal("create-room") }).strict(),
    z.object({
        type: z.literal("join-room"),
        roomId: z.string().uuid(),
        invitationToken: z.string().length(43),
    }).strict(),
    z.object({
        type: z.literal("peer-message"),
        text: z.string().min(1).max(200),
    }).strict(),
]);

export function registerSignalingGateway(
    app: FastifyInstance,
    auth: ReturnType<typeof createAuth>,
    allowedOrigin: string,
) {
    // Temporary room state belongs to this gateway instance.
    const rooms = new Map<string, Room>();
    const connections = createConnectionRegistry();
    // One store for all connections, not one Map per incoming message.
    const invitations = createInvitationStore();
    const invitationCleanup = setInterval(() => invitations.removeExpired(), 30_000);
    invitationCleanup.unref();
    app.addHook("onClose", async () => { clearInterval(invitationCleanup); });
    const verifiedIdentities = new WeakMap<FastifyRequest, { userId: string; sessionId: string }>();

    app.get("/api/signaling", {
        websocket: true,
        preValidation: async (request, reply) => {
            // Origin is a browser protection; session validation supplies identity.
            if (request.headers.origin !== allowedOrigin) {
                return reply.code(403).send({ error: "Origin is not allowed" });
            }

            const session = await auth.api.getSession({
                headers: fromNodeHeaders(request.headers),
                query: { disableCookieCache: true, disableRefresh: true },
            });
            if (!session) {
                return reply.code(401).send({ error: "You must be signed in" });
            }
            verifiedIdentities.set(request, { userId: session.user.id, sessionId: session.session.id });
        },
    }, (socket, request) => {
        // Membership is associated with the connection, not supplied on every message.
        let currentRoomId: string | undefined;

        const sessionHeader = fromNodeHeaders(request.headers);
        const identity = verifiedIdentities.get(request);
        verifiedIdentities.delete(request);
        if (!identity) {
            socket.close(1008, "Authenticated identity missing");
            return;
        }
        const connection = connections.add(identity.userId, identity.sessionId, socket);

        function send(target: WebSocket, message: object) {
            if (target.readyState === WebSocket.OPEN) {
                target.send(JSON.stringify(message));
            }
        }

        function reportError(text: string) {
            send(socket, { type: "error", text });
        }

        async function ensureSession(): Promise<boolean> {
            if (socket.readyState !== WebSocket.OPEN) {
                return false;
            }

            try {
                const session = await auth.api.getSession({
                    headers: sessionHeader,
                    query: {
                        disableCookieCache: true,
                        disableRefresh: true,
                    },
                });

                if (socket.readyState !== WebSocket.OPEN) {
                    return false;
                }

                if (!session || session.user.id !== connection.userId || session.session.id !== connection.sessionId) {
                    socket.close(1008, "Session expired or revoked");
                    return false;
                }

                return true;
            } catch {
                socket.close(1011, "Session verification unavailable");
                return false;
            }
        }


        function processMessage(data: RawData, isBinary: boolean) {
            if (isBinary) {
                socket.close(1003, "Text messages only");
                return;
            }

            let message: unknown;
            try {
                message = JSON.parse(data.toString());
            } catch {
                reportError("Invalid JSON");
                return;
            }

            const result = messageCheck.safeParse(message);
            if (!result.success) {
                reportError("Invalid message");
                return;
            }

            if (result.data.type === "create-invitation") {
                const recipients = connections.getForUser(result.data.recipientUserId)
                    .filter(candidate => candidate.socket.readyState === WebSocket.OPEN
                        && candidate.connectionId !== connection.connectionId);
                if (recipients.length === 0) {
                    reportError("Recipient is unavailable");
                    return;
                }

                const invitation = invitations.create({
                    senderUserId: connection.userId,
                    senderConnectionId: connection.connectionId,
                    recipientUserId: result.data.recipientUserId,
                });
                for (const recipient of recipients) {
                    send(recipient.socket, {
                        type: "invitation-received",
                        invitationId: invitation.id,
                        senderUserId: invitation.senderUserId,
                        expiresAt: invitation.expiresAt,
                    });
                }
                send(socket, {
                    type: "invitation-created",
                    invitationId: invitation.id,
                    recipientUserId: invitation.recipientUserId,
                    expiresAt: invitation.expiresAt,
                });
                return;
            }
            if (result.data.type === "accept-invitation") {
                const invitation = invitations.getById(result.data.invitationId);
                if (!invitation || invitation.recipientUserId !== connection.userId) {
                    reportError("Invitation is unavailable");
                    return;
                }

                const sender = connections.getForUser(invitation.senderUserId)
                    .find(candidate => candidate.connectionId === invitation.senderConnectionId
                        && candidate.socket.readyState === WebSocket.OPEN);
                if (!sender) {
                    reportError("The sender is no longer connected");
                    return;
                }

                // Identity comes from the authenticated socket, not from client fields.
                // No await between this check/update and notifications: one acceptance wins.
                const accepted = invitations.acceptInv(
                    invitation.id, connection.userId, connection.connectionId,
                );
                if (!accepted) {
                    reportError("Invitation could not be accepted");
                    return;
                }

                send(socket, {
                    type: "invitation-accepted",
                    invitationId: invitation.id,
                    role: "receiver",
                });
                send(sender.socket, {
                    type: "invitation-accepted",
                    invitationId: invitation.id,
                    role: "sender",
                });
                for (const other of connections.getForUser(connection.userId)) {
                    if (other.connectionId === connection.connectionId
                        || other.connectionId === sender.connectionId) continue;
                    send(other.socket, {
                        type: "invitation-accepted-elsewhere",
                        invitationId: invitation.id,
                    });
                }
                return;
            }
            if (result.data.type === "create-room") {
                if (currentRoomId) {
                    reportError("You already belong to a room");
                    return;
                }
                const roomId = randomUUID();
                const invitationToken = randomBytes(32).toString("base64url");
                rooms.set(roomId, { members: new Set([socket]), invitationToken });
                currentRoomId = roomId;
                send(socket, { type: "room-created", roomId, invitationToken });
                return;
            }

            if (result.data.type === "join-room") {
                if (currentRoomId) {
                    reportError("You already belong to a room");
                    return;
                }
                const room = rooms.get(result.data.roomId);
                if (!room || room.invitationToken !== result.data.invitationToken) {
                    reportError("Invalid room invitation");
                    return;
                }
                if (room.members.size >= 2) {
                    reportError("Room is full");
                    return;
                }
                room.members.add(socket);
                currentRoomId = result.data.roomId;
                send(socket, { type: "room-joined", roomId: currentRoomId });
                for (const member of room.members) {
                    send(member, { type: "peer-ready" });
                }
                return;
            }

            const room = currentRoomId ? rooms.get(currentRoomId) : undefined;
            if (!room || !room.members.has(socket)) {
                reportError("Join or create a room first");
                return;
            }
            if (room.members.size !== 2) {
                reportError("Your peer is not connected");
                return;
            }
            for (const member of room.members) {
                if (member === socket) continue;
                send(member, { type: "peer-message", text: result.data.text });
            }
        }

        // Keep one message in flight so asynchronous session checks cannot race.
        // Overlapping messages are rejected in this prototype, not queued.
        let processingMessage = false;
        socket.on("message", async (data, isBinary) => {
            if (processingMessage) {
                reportError("Please wait for the previous message");
                return;
            }
            processingMessage = true;
            try {
                if (!(await ensureSession())) return;
                processMessage(data, isBinary);
            } catch {
                socket.close(1011, "Message processing failed");
            } finally {
                processingMessage = false;
            }
        });

        let checkingIdleSession = false;
        const sessionTimer = setInterval(async () => {
            if (checkingIdleSession) return;
            checkingIdleSession = true;
            try {
                await ensureSession();
            } finally {
                checkingIdleSession = false;
            }
        }, 30_000);
        sessionTimer.unref();

        socket.on("close", () => {
            clearInterval(sessionTimer);
            invitations.removeForSender(connection.connectionId);
            connections.remove(connection.connectionId);
            if (!currentRoomId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;
            room.members.delete(socket);
            if (room.members.size === 0) {
                rooms.delete(currentRoomId);
            } else {
                for (const member of room.members) send(member, { type: "peer-left" });
            }
        });

        socket.on("error", (error) => { app.log.error(error); });
    });
}
