export type ActivePair = Readonly<{
    pairId: string;
    senderConnectionId: string;
    receiverConnectionId: string;
}>;

// Pairing lives until disconnect, independently of the pending invitation deadline.
export function createPairStore() {
    const pairs = new Map<string, ActivePair>();
    const pairIdByConnection = new Map<string, string>();

    return {
        create(pair: ActivePair): ActivePair | undefined {
            if (pairs.has(pair.pairId)
                || pair.senderConnectionId === pair.receiverConnectionId
                || pairIdByConnection.has(pair.senderConnectionId)
                || pairIdByConnection.has(pair.receiverConnectionId)) return undefined;
            const stored = Object.freeze({ ...pair });
            pairs.set(stored.pairId, stored);
            pairIdByConnection.set(stored.senderConnectionId, stored.pairId);
            pairIdByConnection.set(stored.receiverConnectionId, stored.pairId);
            return stored;
        },
        getById(pairId: string): ActivePair | undefined {
            return pairs.get(pairId);
        },
        getForConnection(connectionId: string): ActivePair | undefined {
            const id = pairIdByConnection.get(connectionId);
            return id ? pairs.get(id) : undefined;
        },
        removeForConnection(connectionId: string): ActivePair | undefined {
            const id = pairIdByConnection.get(connectionId);
            const pair = id ? pairs.get(id) : undefined;
            if (!pair) return undefined;
            pairs.delete(pair.pairId);
            pairIdByConnection.delete(pair.senderConnectionId);
            pairIdByConnection.delete(pair.receiverConnectionId);
            return pair;
        },
    };
}
