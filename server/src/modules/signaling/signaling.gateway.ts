import { createPairStore } from './signaling.pairs.js';
import { createInvitationStore } from './signaling.invitations.js';
import { fromNodeHeaders } from 'better-auth/node';
import type { createAuth } from '../auth/auth.js';
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createConnectionRegistry } from "./signaling.connections.js";
import * as z from "zod";
import WebSocket, { type RawData } from "ws";

const messageCheck = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("accept-invitation"),
        invitationId: z.string().uuid(),
    }).strict(),
    z.object({
        type: z.literal("create-invitation"),
        recipientUserId: z.string().trim().min(1).max(128),
    }).strict(),
    z.object({
        type: z.literal("peer-message"),
        pairId: z.string().uuid(),
        text: z.string().min(1).max(200),
    }).strict(),
]);

export function registerSignalingGateway(
    app: FastifyInstance,
    auth: ReturnType<typeof createAuth>,
    allowedOrigin: string,
) {
    const pairs = createPairStore();
    const sessionValidators = new Map<string, () => Promise<boolean>>();
    const connections = createConnectionRegistry();
    // One store for all connections, not one Map per incoming message.
    const invitations = createInvitationStore();
    const invitationCleanup = setInterval(() => invitations.removeExpired(), 30_000);
    invitationCleanup.unref();
    app.addHook("onClose", async () => { clearInterval(invitationCleanup); });
    const verifiedIdentities = new WeakMap<FastifyRequest, { userId: string; sessionId: string }>();

    function sendToConnection(connectionId: string, message: object) {
        const target = connections.getById(connectionId);
        if (target?.socket.readyState === WebSocket.OPEN) target.socket.send(JSON.stringify(message));
    }

    function endPair(connectionId: string) {
        const pair = pairs.removeForConnection(connectionId);
        if (!pair) return;
        const message = { type: "pair-ended", pairId: pair.pairId, reason: "peer-disconnected" };
        sendToConnection(pair.senderConnectionId, message);
        sendToConnection(pair.receiverConnectionId, message);
    }
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
                    endPair(connection.connectionId);
                    return false;
                }

                return true;
            } catch {
                socket.close(1011, "Session verification unavailable");
                endPair(connection.connectionId);
                return false;
            }
        }


        sessionValidators.set(connection.connectionId, ensureSession);

        async function processMessage(data: RawData, isBinary: boolean) {
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
                if (pairs.getForConnection(connection.connectionId)) {
                    reportError("This connection already has an active pair");
                    return;
                }
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

                // Validate the selected sender before binding. Awaiting may allow another
                // acceptance or disconnect, so repeat all local checks afterward.
                if (!(await sessionValidators.get(sender.connectionId)?.())) {
                    reportError("The sender is no longer available");
                    return;
                }
                if (socket.readyState !== WebSocket.OPEN || sender.socket.readyState !== WebSocket.OPEN) return;
                if (pairs.getForConnection(connection.connectionId) || pairs.getForConnection(sender.connectionId)) {
                    reportError("A selected connection already has an active pair");
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

                const pair = pairs.create({
                    pairId: invitation.id,
                    senderConnectionId: sender.connectionId,
                    receiverConnectionId: connection.connectionId,
                });
                if (!pair) throw new Error("Pair creation invariant failed");
                // The accepted pair now owns the lifetime; the invitation is consumed.
                invitations.remove(invitation.id);

                send(socket, {
                    type: "invitation-accepted",
                    invitationId: invitation.id,
                    pairId: pair.pairId,
                    role: "receiver",
                });
                send(sender.socket, {
                    type: "invitation-accepted",
                    invitationId: invitation.id,
                    pairId: pair.pairId,
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
            const pair = pairs.getById(result.data.pairId);
            if (!pair || (pair.senderConnectionId !== connection.connectionId
                && pair.receiverConnectionId !== connection.connectionId)) {
                reportError("You are not a participant in this active pair");
                return;
            }
            const peerId = pair.senderConnectionId === connection.connectionId
                ? pair.receiverConnectionId : pair.senderConnectionId;
            const peer = connections.getById(peerId);
            if (!peer || peer.socket.readyState !== WebSocket.OPEN) {
                endPair(connection.connectionId);
                return;
            }
            // Never deliver to a peer whose session has already been revoked.
            if (!(await sessionValidators.get(peerId)?.())) return;
            // A disconnect or pairing change can occur during the session lookup.
            if (socket.readyState !== WebSocket.OPEN || peer.socket.readyState !== WebSocket.OPEN
                || pairs.getById(pair.pairId) !== pair) return;
            send(peer.socket, { type: "peer-message", pairId: pair.pairId, text: result.data.text });
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
                await processMessage(data, isBinary);
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
            sessionValidators.delete(connection.connectionId);
            endPair(connection.connectionId);
        });

        socket.on("error", (error) => { app.log.error(error); });
    });
}
