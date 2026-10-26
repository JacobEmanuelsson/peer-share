import type { ConnectionRoute } from '../../../webrtc/connectionRoute';
import * as z from 'zod';
import { rtcSignalSchema } from '../../signaling/api/signalingClient';
import { createPeerConnection, type PeerStatus } from '../../../webrtc/peerConnection';
import type { FileOffer, TransferProgress, ChatText, ReceivedFile } from '../../../webrtc/fileTransfer';

const profile = z.object({ id: z.string().uuid(), userId: z.string(), name: z.string() });
export type GroupPeer = z.infer<typeof profile>;
const serverMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('roster'), selfId: z.string().uuid(), peers: z.array(profile).max(5) }),
  z.object({ type: z.literal('signal'), from: z.string().uuid(), signal: rtcSignalSchema }),
]);
type Handlers = {
  onRoster: (peers: GroupPeer[]) => void;
  onStatus: (id: string, status: PeerStatus) => void;
  onRoute: (id: string, route: ConnectionRoute) => void;
  onOffer: (id: string, offer: FileOffer | null) => void;
  onProgress: (id: string, progress: TransferProgress) => void;
  onFile: (id: string, file: ReceivedFile) => void;
  onText: (id: string, message: ChatText) => void;
  onError: (message: string) => void;
  onDisconnected: () => void;
};
export function connectGroup(groupId: string, handlers: Handlers) {
  const url = new URL('/api/groups/' + encodeURIComponent(groupId) + '/signaling', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const peers = new Map<string, ReturnType<typeof createPeerConnection>>();
  let disposed = false;
  function closePeers() { for (const peer of peers.values()) peer.close(); peers.clear(); }
  socket.onmessage = event => {
    if (disposed) return;
    try {
      const message = serverMessage.parse(JSON.parse(event.data));
      if (message.type === 'signal') { peers.get(message.from)?.handleSignal(message.signal); return; }
      for (const [id, peer] of peers) if (!message.peers.some(other => other.id === id)) { peer.close(); peers.delete(id); }
      handlers.onRoster(message.peers);
      for (const other of message.peers) {
        if (peers.has(other.id)) continue;
        const peer = createPeerConnection({
          role: message.selfId < other.id ? 'sender' : 'receiver',
          sendSignal: signal => {
            if (disposed || socket.readyState !== WebSocket.OPEN) return false;
            socket.send(JSON.stringify({ type: 'signal', to: other.id, signal })); return true;
          },
          onStatus: status => { if (!disposed) handlers.onStatus(other.id, status); },
          onRoute: route => { if (!disposed) handlers.onRoute(other.id, route); },
          onOffer: offer => { if (!disposed) handlers.onOffer(other.id, offer); },
          onProgress: progress => { if (!disposed) handlers.onProgress(other.id, progress); },
          onFile: file => { if (!disposed) handlers.onFile(other.id, file); else void file.dispose?.(); },
          onText: text => { if (!disposed) handlers.onText(other.id, text); },
          onError: text => { if (!disposed) handlers.onError(other.name + ': ' + text); },
        });
        peers.set(other.id, peer); void peer.start();
      }
    } catch { handlers.onError('Group connection could not be initialized. Leave and rejoin.'); closePeers(); socket.close(); }
  };
  socket.onerror = () => { if (!disposed) handlers.onError('Could not join this group. Check membership, sign-in, or another open tab.'); };
  socket.onclose = () => { closePeers(); if (!disposed) handlers.onDisconnected(); };
  return {
    sendFile: (id: string, file: File) => peers.get(id)?.sendFile(file) ?? Promise.resolve(),
    cancelFile: (id: string, direction: 'send' | 'receive') => peers.get(id)?.cancelFile(direction),
    acceptFile: (id: string, accept: boolean) => peers.get(id)?.acceptFile(accept),
    sendText: (id: string, text: string, messageId?: string) => peers.get(id)?.sendText(text, messageId) ?? null,
    close() { disposed = true; closePeers(); socket.close(); },
  };
}