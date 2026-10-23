import { createSHA256, hashFile } from './incrementalHash';
import { createTemporaryFile, type FileSink } from './temporaryFile';
import * as z from 'zod';

import { MAX_FILE_BYTES } from './transferLimits';
export { MAX_FILE_BYTES } from './transferLimits';
export const CHUNK_BYTES = 16 * 1024;
const offerSchema = z.object({
  type: z.literal('file-offer'), id: z.string().uuid(),
  name: z.string().min(1).max(255), size: z.number().int().min(0).max(MAX_FILE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const controlSchema = z.discriminatedUnion('type', [
  offerSchema,
  z.object({ type: z.literal('file-cancel'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('file-progress'), id: z.string().uuid(), bytes: z.number().int().min(0).max(MAX_FILE_BYTES) }).strict(),
  z.object({ type: z.literal('text'), id: z.string().uuid(), text: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('file-accept'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('file-reject'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('file-end'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('file-complete'), id: z.string().uuid() }).strict(),
]);
export class TransferCancelled extends Error { constructor() { super('File transfer cancelled'); } }
export type ChatText = { id: string; text: string };
export type ReceivedFile = { id: string; name: string; blob: Blob; dispose?: () => Promise<void> };
export type FileOffer = z.infer<typeof offerSchema>;
export type TransferProgress = { id: string; direction: 'send' | 'receive'; name: string; bytes: number; total: number; status: 'waiting' | 'transferring' | 'verifying' | 'complete' | 'declined' | 'interrupted' | 'cancelled' | 'failed' };

type Options = {
  createSink?: (size: number) => Promise<FileSink>;
  sendControl: (message: object) => void;
  sendChunk: (data: ArrayBuffer) => Promise<void>;
  chunkSize: () => number;
  onText: (message: ChatText) => void;
  onOffer: (offer: FileOffer | null) => void;
  onProgress: (progress: TransferProgress) => void;
  onFile: (file: ReceivedFile) => void;
};

async function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('File transfer response timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer!); }
}

export function createFileTransfer(options: Options) {
  const lastProgress = new Map<string, { at: number; status: string }>();
  const report = options.onProgress;
  options = { ...options, onProgress(value) {
    const previous = lastProgress.get(value.direction), now = Date.now();
    if (previous?.status === value.status && value.status === 'transferring' && now - previous.at < 100 && value.bytes !== value.total) return;
    lastProgress.set(value.direction, { at: now, status: value.status }); report(value);
  } };
  let closed = false;
  let sending = false;
  const cancelledIds = new Set<string>();
  let outgoing: { stage: 'waiting' | 'sending' | 'verifying' | 'complete' | 'declined' | 'failed'; name: string; size: number; id: string; cancelled: boolean; sent: number; acknowledged: number; wake: (() => void) | null; accept: (value: boolean) => void; complete: (value: boolean) => void } | null = null;
  let incoming: { offer: FileOffer; sink: FileSink | null; hasher: Awaited<ReturnType<typeof createSHA256>> | null; preparing: boolean; bytes: number; acknowledged: number; accepted: boolean; cancelled: boolean; finalizing: boolean } | null = null;

  return {
    async sendFile(file: File): Promise<void> {
      if (closed || sending) throw new Error('This connection cannot start another file transfer');
      if (file.size > MAX_FILE_BYTES || !file.name || file.name.length > 255) throw new Error('Choose a file of at most 1 GiB with a name of at most 255 characters');
      sending = true;
      try {
        const id = crypto.randomUUID();
        const accepted = new Promise<boolean>(resolve => {
          outgoing = { stage: 'waiting', name: file.name, size: file.size, id, cancelled: false, sent: 0, acknowledged: 0, wake: null, accept: resolve, complete: () => {} };
        });
        const completed = new Promise<boolean>(resolve => { outgoing!.complete = resolve; });
        const sha256 = await hashFile(file, () => closed || !!outgoing?.cancelled);
        if (closed) throw new Error('Connection closed'); if (outgoing?.cancelled) throw new TransferCancelled();
        options.sendControl({ type: 'file-offer', id, name: file.name, size: file.size, sha256 });
        options.onProgress({ id, direction: 'send', name: file.name, bytes: 0, total: file.size, status: 'waiting' });
        if (!(await deadline(accepted, 60_000))) { if (outgoing?.cancelled) throw new TransferCancelled(); if (!closed) options.onProgress({ id, direction: 'send', name: file.name, bytes: 0, total: file.size, status: 'declined' }); return; }
        outgoing!.stage = 'sending';
        let offset = 0;
        while (offset < file.size) {
          if (closed) throw new Error('Connection closed'); if (outgoing?.cancelled) throw new TransferCancelled();
          while (outgoing!.sent - outgoing!.acknowledged >= 256 * 1024) {
            await deadline(new Promise<void>(resolve => { outgoing!.wake = resolve; }), 120_000);
            if (closed) throw new Error('Connection closed'); if (outgoing?.cancelled) throw new TransferCancelled();
          }
          const chunk = await file.slice(offset, offset + options.chunkSize()).arrayBuffer();
          outgoing!.sent += chunk.byteLength;
          await options.sendChunk(chunk);
          offset += chunk.byteLength;
          options.onProgress({ id, direction: 'send', name: file.name, bytes: offset, total: file.size, status: 'transferring' });
        }
        if (outgoing?.cancelled) throw new TransferCancelled();
        outgoing!.stage = 'verifying';
        options.sendControl({ type: 'file-end', id });
        options.onProgress({ id, direction: 'send', name: file.name, bytes: offset, total: file.size, status: 'verifying' });
        if (outgoing?.cancelled) throw new TransferCancelled();
        if (!(await deadline(completed, 120_000))) throw new Error('The receiver did not confirm the file');
        if (!closed) options.onProgress({ id, direction: 'send', name: file.name, bytes: file.size, total: file.size, status: 'complete' });
      } catch (error) {
        if (outgoing?.cancelled) {
          cancelledIds.add(outgoing.id); if (cancelledIds.size > 32) cancelledIds.delete(cancelledIds.values().next().value!);
          if (!closed) { options.sendControl({ type: 'file-cancel', id: outgoing.id }); options.onProgress({ id: outgoing.id, direction: 'send', name: outgoing.name, bytes: outgoing.sent, total: outgoing.size, status: 'cancelled' }); }
          throw new TransferCancelled();
        }
        if (!closed && outgoing) {
          outgoing.stage = 'failed';
          options.onProgress({ id: outgoing.id, direction: 'send', name: outgoing.name, bytes: 0, total: outgoing.size, status: 'failed' });
        }
        throw error;
      } finally { outgoing = null; sending = false; }
    },
    async acceptFile(accept: boolean) {
      const transfer = incoming;
      if (closed || !transfer || transfer.accepted || transfer.preparing) return;
      transfer.preparing = true;
      try {
        if (accept) {
          transfer.sink = await (options.createSink ?? createTemporaryFile)(transfer.offer.size);
          transfer.hasher = await createSHA256(); transfer.hasher.init();
          if (closed || incoming !== transfer || transfer.cancelled) { await transfer.sink.dispose(); return; }
          transfer.accepted = true;
          options.onProgress({ id: transfer.offer.id, direction: 'receive', name: transfer.offer.name, bytes: 0, total: transfer.offer.size, status: 'transferring' });
        } else {
          options.onProgress({ id: transfer.offer.id, direction: 'receive', name: transfer.offer.name, bytes: 0, total: transfer.offer.size, status: 'declined' });
          incoming = null;
        }
        options.sendControl({ type: accept ? 'file-accept' : 'file-reject', id: transfer.offer.id });
        options.onOffer(null);
      } catch (error) {
        await transfer.sink?.dispose();
        if (!closed) {
          incoming = null; options.onOffer(null);
          options.sendControl({ type: 'file-reject', id: transfer.offer.id });
          options.onProgress({ id: transfer.offer.id, direction: 'receive', name: transfer.offer.name, bytes: 0, total: transfer.offer.size, status: 'failed' });
        }
        throw error;
      }
    },
    async receive(data: string | ArrayBuffer) {
      if (closed) return;
      if (data instanceof ArrayBuffer) {
        if (!incoming?.accepted || incoming.finalizing || data.byteLength === 0 || data.byteLength > CHUNK_BYTES
            || incoming.bytes + data.byteLength > incoming.offer.size) throw new Error('Invalid file chunk');
        if (incoming.cancelled) { incoming.bytes += data.byteLength; return; }
        const writing = incoming;
        try { await writing.sink!.write(data); } catch (error) { if (writing.cancelled || closed) return; throw error; }
        if (closed || !incoming || writing.cancelled) return;
        incoming.hasher!.update(new Uint8Array(data));
        incoming.bytes += data.byteLength;
        if (incoming.bytes - incoming.acknowledged >= 64 * 1024 || incoming.bytes === incoming.offer.size) {
          incoming.acknowledged = incoming.bytes;
          options.sendControl({ type: 'file-progress', id: incoming.offer.id, bytes: incoming.bytes });
        }
        options.onProgress({ id: incoming.offer.id, direction: 'receive', name: incoming.offer.name, bytes: incoming.bytes, total: incoming.offer.size, status: 'transferring' });
        return;
      }
      if (data.length > 16 * 1024) throw new Error('DataChannel control message is too large');
      const message = controlSchema.parse(JSON.parse(data));
      if (message.type === 'file-cancel') {
        if (outgoing?.id === message.id) { outgoing.cancelled = true; outgoing.wake?.(); outgoing.accept(false); outgoing.complete(false); }
        if (incoming?.offer.id === message.id) {
          const transfer = incoming; incoming = null; options.onOffer(null);
          await transfer.sink?.dispose();
          options.onProgress({ id: transfer.offer.id, direction: 'receive', name: transfer.offer.name, bytes: transfer.bytes, total: transfer.offer.size, status: 'cancelled' });
        }
        return;
      }
      if (message.type === 'text') { options.onText({ id: message.id, text: message.text }); return; }
      if (message.type === 'file-offer') {
        if (incoming) throw new Error('Unexpected file offer');
        incoming = { offer: message, sink: null, hasher: null, preparing: false, bytes: 0, acknowledged: 0, accepted: false, cancelled: false, finalizing: false };
        options.onOffer(message);
        return;
      }
      if (cancelledIds.has(message.id)) return;
      if (message.type === 'file-progress') {
        if (!outgoing || !['sending', 'verifying'].includes(outgoing.stage) || outgoing.id !== message.id
            || message.bytes < outgoing.acknowledged || message.bytes > outgoing.sent) throw new Error('Invalid file acknowledgement');
        outgoing.acknowledged = message.bytes; outgoing.wake?.(); outgoing.wake = null; return;
      }
      if (message.type === 'file-accept' || message.type === 'file-reject') {
        if (!outgoing || outgoing.stage !== 'waiting' || outgoing.id !== message.id) throw new Error('Unexpected file response');
        outgoing.stage = message.type === 'file-accept' ? 'sending' : 'declined';
        if (message.type === 'file-reject') options.onProgress({ id: outgoing.id, direction: 'send', name: outgoing.name, bytes: 0, total: outgoing.size, status: 'declined' });
        outgoing.accept(message.type === 'file-accept'); return;
      }
      if (message.type === 'file-complete') {
        if (!outgoing || outgoing.stage !== 'verifying' || outgoing.id !== message.id) throw new Error('Unexpected completion');
        outgoing.stage = 'complete';
        options.onProgress({ id: outgoing.id, direction: 'send', name: outgoing.name, bytes: outgoing.size, total: outgoing.size, status: 'complete' });
        outgoing.complete(true); return;
      }
      if (incoming?.cancelled) return;
      const transfer = incoming;
      if (!transfer?.accepted || transfer.finalizing || transfer.offer.id !== message.id || transfer.bytes !== transfer.offer.size) throw new Error('File was incomplete');
      transfer.finalizing = true;
      options.onProgress({ id: transfer.offer.id, direction: 'receive', name: transfer.offer.name, bytes: transfer.bytes, total: transfer.offer.size, status: 'verifying' });
      const sha256 = transfer.hasher!.digest('hex');
      if (closed) return;
      if (sha256 !== transfer.offer.sha256) { await transfer.sink!.dispose(); throw new Error('File integrity verification failed'); }
      let blob: Blob;
      try { blob = await transfer.sink!.finish(); } catch (error) { if (transfer.cancelled || closed) return; throw error; }
      if (closed || transfer.cancelled) { await transfer.sink!.dispose(); return; }
      incoming = null;
      options.onFile({ id: transfer.offer.id, name: transfer.offer.name, blob, dispose: () => transfer.sink!.dispose() });
      options.sendControl({ type: 'file-complete', id: transfer.offer.id });
      options.onProgress({ id: transfer.offer.id, direction: 'receive', name: transfer.offer.name, bytes: transfer.bytes, total: transfer.offer.size, status: 'complete' });
    },
    cancelFile(direction: 'send' | 'receive') {
      if (closed) return;
      if (direction === 'send' && outgoing && !['complete', 'declined', 'failed'].includes(outgoing.stage)) {
        outgoing.cancelled = true; outgoing.wake?.(); outgoing.accept(false); outgoing.complete(false);
      }
      if (direction === 'receive' && incoming && !incoming.cancelled) {
        incoming.cancelled = true; void incoming.sink?.dispose(); options.onOffer(null);
        options.onProgress({ id: incoming.offer.id, direction: 'receive', name: incoming.offer.name, bytes: incoming.bytes, total: incoming.offer.size, status: 'cancelled' });
        options.sendControl({ type: 'file-cancel', id: incoming.offer.id });
      }
    },
    close() {
      if (closed) return;
      closed = true;
      if (outgoing && !['complete', 'declined', 'failed'].includes(outgoing.stage)) {
        options.onProgress({ id: outgoing.id, direction: 'send', name: outgoing.name, bytes: 0, total: outgoing.size, status: 'interrupted' });
      }
      if (incoming) options.onProgress({ id: incoming.offer.id, direction: 'receive', name: incoming.offer.name, bytes: incoming.bytes, total: incoming.offer.size, status: 'interrupted' });
      void incoming?.sink?.dispose(); outgoing?.wake?.();
      outgoing?.accept(false); outgoing?.complete(false);
      incoming = null;
    },
  };
}
