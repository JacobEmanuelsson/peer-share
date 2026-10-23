import { useCallback, useEffect, useRef, useState } from 'react';
import { fileKey, interruptedHistory, mergeHistory, recordFile, textEntry, type ChatEntry, type Person } from './chatHistory';
import { readChat, saveChat } from './chatStore';
import type { ChatText, ReceivedFile, TransferProgress } from '../../webrtc/fileTransfer';

type Scope = { userId: string; conversation: string; entries: ChatEntry[]; ready: boolean; cleared: boolean };
export function useChatHistory(me: Person, conversation: string | null) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [downloads, setDownloads] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [storageError, setStorageError] = useState('');
  const active = useRef<Scope | null>(null);
  const owner = useRef(me); owner.current = me;
  const blobs = useRef(new Map<string, { url: string; size: number; dispose?: () => Promise<void> }>());
  const release = useCallback(() => {
    for (const { url, dispose } of blobs.current.values()) { URL.revokeObjectURL(url); void dispose?.(); }
    blobs.current.clear(); setDownloads({});
  }, []);
  const persist = useCallback((scope: Scope) => {
    if (scope.ready) void saveChat(scope.userId, scope.conversation, scope.entries).catch(error => {
      if (active.current === scope) setStorageError(error instanceof Error ? error.message : 'History could not be saved.');
    });
  }, []);
  useEffect(() => {
    setEntries([]); setStorageError(''); release();
    if (!conversation) { active.current = null; setLoading(false); return; }
    const scope: Scope = { userId: me.id, conversation, entries: [], ready: false, cleared: false };
    active.current = scope; setLoading(true);
    void readChat(me.id, conversation).then(stored => {
      if (active.current !== scope) return;
      scope.entries = mergeHistory(scope.cleared ? [] : interruptedHistory(stored), scope.entries);
      scope.ready = true; setEntries(scope.entries); setLoading(false); persist(scope);
    }).catch(error => {
      if (active.current !== scope) return;
      setLoading(false); setStorageError(error instanceof Error ? error.message : 'Local history unavailable.');
    });
    return () => {
      scope.entries = interruptedHistory(scope.entries); persist(scope);
      if (active.current === scope) active.current = null;
      release();
    };
  }, [me.id, conversation, persist, release]);
  const update = useCallback((reduce: (current: ChatEntry[]) => ChatEntry[]) => {
    const scope = active.current; if (!scope) return;
    const next = reduce(scope.entries);
    if (next === scope.entries) return;
    scope.entries = next; setEntries(next); persist(scope);
  }, [persist]);
  const addText = useCallback((message: ChatText, peer: Person, direction: 'send' | 'receive', recipients?: Person[]) => {
    const me = owner.current;
    const entry = textEntry(message, me, peer, direction, recipients ?? [direction === 'send' ? peer : me]);
    update(current => current.some(item => item.key === entry.key) ? current : mergeHistory(current, [entry]));
  }, [update]);
  const addFile = useCallback((progress: TransferProgress, peer: Person) => update(current => recordFile(current, progress, owner.current, peer)), [update]);
  const attachDownload = useCallback((file: ReceivedFile, peer: Person) => {
    if (!active.current) { void file.dispose?.(); return; }
    const key = fileKey('receive', peer.id, file.id);
    const old = blobs.current.get(key); if (old) { URL.revokeObjectURL(old.url); void old.dispose?.(); }
    blobs.current.delete(key);
    blobs.current.set(key, { url: URL.createObjectURL(file.blob), size: file.blob.size, dispose: file.dispose });
    while (blobs.current.size > 10 || [...blobs.current.values()].reduce((sum, value) => sum + value.size, 0) > 2 * 1024 * 1024 * 1024) {
      const oldest = blobs.current.keys().next().value!;
      URL.revokeObjectURL(blobs.current.get(oldest)!.url); void blobs.current.get(oldest)!.dispose?.(); blobs.current.delete(oldest);
    }
    setDownloads(Object.fromEntries([...blobs.current].map(([id, item]) => [id, item.url])));
  }, []);
  const clear = useCallback(() => {
    const scope = active.current; if (!scope) return;
    scope.cleared = true; scope.entries = []; setEntries([]); release();
    void saveChat(scope.userId, scope.conversation, [], true).catch(error => {
      if (active.current === scope) setStorageError(error instanceof Error ? error.message : 'History could not be cleared.');
    });
  }, [release, persist]);
  return { entries, downloads, loading, storageError, addText, addFile, attachDownload, clear };
}