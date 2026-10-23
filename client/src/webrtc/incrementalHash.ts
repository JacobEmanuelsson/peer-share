import { createSHA256 } from 'hash-wasm';

export { createSHA256 };
export async function hashFile(file: Blob, cancelled: () => boolean): Promise<string> {
  const hash = await createSHA256();
  hash.init();
  for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
    if (cancelled()) throw new Error('Connection closed');
    hash.update(new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer()));
  }
  return hash.digest('hex');
}