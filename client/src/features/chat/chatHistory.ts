import * as z from 'zod';
import { MAX_FILE_BYTES } from '../../webrtc/transferLimits';
import type { ChatText, TransferProgress } from '../../webrtc/fileTransfer';

export const HISTORY_LIMIT = 200;
const person = z.object({ id: z.string().min(1).max(128), name: z.string().max(100) });
export type Person = z.infer<typeof person>;
const common = {
  key: z.string().max(600), sender: person, recipients: z.array(person).max(5),
  direction: z.enum(['send', 'receive']), at: z.number().int().min(0).max(8_640_000_000_000_000),
};
export const entriesSchema = z.array(z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('text'), text: z.string().max(2000) }),
  z.object({ ...common, kind: z.literal('file'), file: z.object({
    id: z.string().uuid(), name: z.string().min(1).max(255), size: z.number().int().min(0).max(MAX_FILE_BYTES),
    status: z.enum(['waiting', 'transferring', 'verifying', 'complete', 'declined', 'interrupted', 'cancelled', 'failed']),
  }) }),
])).max(HISTORY_LIMIT);
export type ChatEntry = z.infer<typeof entriesSchema>[number];
export const fileKey = (direction: 'send' | 'receive', peerId: string, id: string) => JSON.stringify(['file', direction, peerId, id]);

export function mergeHistory(stored: ChatEntry[], live: ChatEntry[]): ChatEntry[] {
  const entries = new Map(stored.map(entry => [entry.key, entry]));
  const rank = { waiting: 0, transferring: 1, verifying: 2, declined: 3, interrupted: 3, cancelled: 3, failed: 3, complete: 4 };
  for (const entry of live) {
    const previous = entries.get(entry.key);
    if (previous?.kind === 'file' && entry.kind === 'file' && rank[previous.file.status] > rank[entry.file.status]) continue;
    entries.set(entry.key, entry);
  }
  return [...entries.values()].sort((a, b) => a.at - b.at).slice(-HISTORY_LIMIT);
}
export function interruptedHistory(entries: ChatEntry[]): ChatEntry[] {
  return entries.map(entry => entry.kind === 'file' && ['waiting', 'transferring', 'verifying'].includes(entry.file.status)
    ? { ...entry, file: { ...entry.file, status: 'interrupted' } } : entry);
}
export function textEntry(message: ChatText, me: Person, peer: Person, direction: 'send' | 'receive', recipients: Person[], at = Date.now()): ChatEntry {
  const sender = direction === 'send' ? me : peer;
  return { key: JSON.stringify(['text', direction, sender.id, message.id]), kind: 'text', sender, recipients, direction, at, text: message.text };
}
export function recordFile(entries: ChatEntry[], progress: TransferProgress, me: Person, peer: Person, at = Date.now()): ChatEntry[] {
  const key = fileKey(progress.direction, peer.id, progress.id);
  const current = entries.find(entry => entry.key === key);
  // Chunk progress belongs in the transfer UI; chat records state transitions only.
  if (current?.kind === 'file' && (current.file.status === progress.status || ['complete', 'declined', 'failed', 'interrupted', 'cancelled'].includes(current.file.status))) return entries;
  const entry: ChatEntry = {
    key, kind: 'file', direction: progress.direction,
    sender: progress.direction === 'send' ? me : peer,
    recipients: [progress.direction === 'send' ? peer : me], at: current?.at ?? at,
    file: { id: progress.id, name: progress.name, size: progress.total, status: progress.status },
  };
  return mergeHistory(entries, [entry]);
}