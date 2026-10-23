import type { RawData } from "ws";

type QueueOptions = {
    process: (data: RawData, isBinary: boolean) => Promise<void>;
    onOverflow: () => void;
    onError: (error: unknown) => void;
    maxMessages?: number;
    maxBytes?: number;
};

// Outstanding limits include the in-flight message, not only waiting messages.
export function createMessageQueue({
    process, onOverflow, onError, maxMessages = 32, maxBytes = 16 * 1024,
}: QueueOptions) {
    if (!Number.isSafeInteger(maxMessages) || maxMessages < 1
        || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new Error("Queue limits must be positive safe integers");
    }
    const waiting: { data: RawData; isBinary: boolean; bytes: number }[] = [];
    let outstandingMessages = 0;
    let outstandingBytes = 0;
    let processing = false;
    let closed = false;

    function close() {
        closed = true;
        for (const item of waiting) {
            outstandingMessages--;
            outstandingBytes -= item.bytes;
        }
        waiting.length = 0;
        // An already-running promise cannot be cancelled here. Its handler must
        // recheck connection/pair validity after awaiting, as the gateway does.
    }

    async function drain() {
        processing = true;
        try {
            while (!closed && waiting.length > 0) {
                const item = waiting.shift()!;
                try {
                    await process(item.data, item.isBinary);
                } finally {
                    outstandingMessages--;
                    outstandingBytes -= item.bytes;
                }
            }
        } catch (error) {
            close();
            onError(error);
        } finally {
            processing = false;
        }
    }

    return {
        enqueue(data: RawData, isBinary: boolean): boolean {
            if (closed) return false;
            const bytes = Array.isArray(data)
                ? data.reduce((total, part) => total + part.byteLength, 0)
                : data.byteLength;
            if (outstandingMessages >= maxMessages || bytes > maxBytes - outstandingBytes) {
                close();
                onOverflow();
                return false;
            }
            waiting.push({ data, isBinary, bytes });
            outstandingMessages++;
            outstandingBytes += bytes;
            if (!processing) void drain();
            return true;
        },
        close,
    };
}
