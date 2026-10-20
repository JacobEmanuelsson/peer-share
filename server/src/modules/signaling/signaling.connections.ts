import { randomUUID } from "node:crypto";
import type WebSocket from "ws";

export type AuthenticatedConnection = {
    readonly connectionId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly socket: WebSocket;
};

// One registry per gateway. Account lookup will support invitations in the next step.
export function createConnectionRegistry() {
    const connections = new Map<string, AuthenticatedConnection>();
    const connectionIdsByUser = new Map<string, Set<string>>();

    return {
        add(userId: string, sessionId: string, socket: WebSocket): AuthenticatedConnection {
            const connection = { connectionId: randomUUID(), userId, sessionId, socket };
            connections.set(connection.connectionId, connection);
            const ids = connectionIdsByUser.get(userId) ?? new Set<string>();
            ids.add(connection.connectionId);
            connectionIdsByUser.set(userId, ids);
            return connection;
        },
        getForUser(userId: string): AuthenticatedConnection[] {
            const result: AuthenticatedConnection[] = [];
            for (const id of connectionIdsByUser.get(userId) ?? []) {
                const connection = connections.get(id);
                if (connection) result.push(connection);
            }
            return result;
        },
        remove(connectionId: string): void {
            const connection = connections.get(connectionId);
            if (!connection) return;
            connections.delete(connectionId);
            const ids = connectionIdsByUser.get(connection.userId);
            ids?.delete(connectionId);
            if (ids?.size === 0) connectionIdsByUser.delete(connection.userId);
        },
    };
}
