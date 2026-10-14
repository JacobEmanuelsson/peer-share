import type { FastifyInstance } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import * as z from "zod";
import WebSocket from "ws";

type Room = {
    members: Set<WebSocket>;
    invitationToken: string;
};

const messageCheck = z.discriminatedUnion("type", [
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

export function registerSignalingGateway(app: FastifyInstance) {
    // Temporary room state belongs to this gateway instance.
    const rooms = new Map<string, Room>();

    app.get("/api/signaling", { websocket: true }, (socket) => {
        // Membership is associated with the connection, not supplied on every message.
        let currentRoomId: string | undefined;

        function send(target: WebSocket, message: object) {
            if (target.readyState === WebSocket.OPEN) {
                target.send(JSON.stringify(message));
            }
        }

        function reportError(text: string) {
            send(socket, { type: "error", text });
        }

        socket.on("message", (data, isBinary) => {
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
        });

        socket.on("close", () => {
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
