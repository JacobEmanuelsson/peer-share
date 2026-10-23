export type FileSink = {
  write(data: ArrayBuffer): Promise<void>;
  finish(): Promise<Blob>;
  dispose(): Promise<void>;
};

// OPFS keeps received bytes on browser-managed disk, rather than in JS arrays.
// Each transfer owns its file; random names never expose the original filename.
export async function createTemporaryFile(size: number): Promise<FileSink> {
  if (!navigator.storage?.getDirectory) throw new Error('This browser does not support temporary disk storage.');
  const estimate = await navigator.storage.estimate();
  if (estimate.quota !== undefined && estimate.quota - (estimate.usage ?? 0) < size + 32 * 1024 * 1024) {
    throw new Error('Not enough browser disk quota for this file. Free storage and try again.');
  }
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle('peer-share-transfers', { create: true });
  // A crashed tab cannot run disposal. Reclaim its files after 24 hours.
  // Live transfers are bounded by stall timeouts; random timestamped names
  // contain no user or original filename information.
  for await (const [entry] of (directory as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    const timestamp = Number(entry.split('_')[0]);
    if (timestamp && Date.now() - timestamp > 24 * 60 * 60 * 1000) {
      await directory.removeEntry(entry).catch(() => {});
    }
  }
  const name = Date.now() + '_' + crypto.randomUUID();
  const handle = await directory.getFileHandle(name, { create: true });
  let stream: FileSystemWritableFileStream;
  try { stream = await handle.createWritable(); }
  catch { await directory.removeEntry(name); throw new Error('This browser cannot stream files to temporary disk. Update your browser.'); }
  const buffer = new Uint8Array(256 * 1024);
  let used = 0;
  let finished = false;
  let disposed = false;
  return {
    async write(data) {
      if (finished || disposed) throw new Error('Temporary file is closed');
      const bytes = new Uint8Array(data);
      if (used + bytes.length > buffer.length) { await stream.write(buffer.slice(0, used)); used = 0; }
      buffer.set(bytes, used); used += bytes.length;
      if (used === buffer.length) { await stream.write(buffer); used = 0; }
    },
    async finish() {
      if (disposed) throw new Error('Temporary file was removed');
      if (used) await stream.write(buffer.slice(0, used));
      await stream.close(); finished = true;
      return handle.getFile();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (!finished) await stream.abort().catch(() => {});
      await directory.removeEntry(name).catch(error => {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) console.error('Could not remove temporary transfer', error);
      });
    },
  };
}