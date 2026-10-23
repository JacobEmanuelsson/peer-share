import { entriesSchema, mergeHistory, type ChatEntry } from './chatHistory';

const pending = new Map<string, Promise<void>>();
const storageKey = (userId: string, conversation: string) => JSON.stringify([userId, conversation]);
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('peer-share-chat', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('conversations', { keyPath: 'key' });
    request.onerror = () => reject(new Error('Local chat storage is unavailable.'));
    request.onblocked = () => reject(new Error('Local chat storage is blocked by another tab.'));
    request.onsuccess = () => resolve(request.result);
  });
}
async function read(key: string): Promise<ChatEntry[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('conversations', 'readonly').objectStore('conversations').get(key);
      request.onsuccess = () => {
        const result = entriesSchema.safeParse(request.result?.entries ?? []);
        if (!result.success) reject(new Error('Saved chat history could not be read.'));
        else resolve(result.data);
      };
      request.onerror = () => reject(new Error('Saved chat history could not be read.'));
    });
  } finally { db.close(); }
}
export async function readChat(userId: string, conversation: string) {
  const key = storageKey(userId, conversation);
  await pending.get(key)?.catch(() => {});
  return read(key);
}
export function saveChat(userId: string, conversation: string, entries: ChatEntry[], clear = false): Promise<void> {
  const key = storageKey(userId, conversation);
  const data = entriesSchema.parse(entries);
  const task = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('conversations', 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(new Error('Chat history could not be saved. Local storage may be full.'));
        const store = transaction.objectStore('conversations');
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            const clearedAt = clear ? Date.now() : request.result?.clearedAt ?? -1;
            const previous = clear ? [] : entriesSchema.parse(request.result?.entries ?? []);
            // Read/merge/write in one transaction so another tab cannot erase newer entries.
            const entries = clear ? [] : mergeHistory(previous, data).filter(entry => entry.at > clearedAt);
            store.put({ key, entries, clearedAt });
          } catch { transaction.abort(); }
        };
      });
    } finally { db.close(); }
  });
  pending.set(key, task);
  void task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {});
  return task;
}
export async function clearAccountHistory(userId: string) {
  await Promise.allSettled([...pending.values()]);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('conversations', 'readwrite');
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error('Could not clear local account history.'));
      const request = tx.objectStore('conversations').openCursor();
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        try { if (JSON.parse(String(cursor.key))[0] === userId) cursor.delete(); } catch { /* Unrelated malformed record. */ }
        cursor.continue();
      };
    });
  } finally { db.close(); }
}