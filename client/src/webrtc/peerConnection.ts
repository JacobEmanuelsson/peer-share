import { selectedConnectionRoute, type ConnectionRoute } from './connectionRoute';
import { loadIceConfiguration } from './iceConfiguration';
import type { RtcSignal } from '../features/signaling/api/signalingClient';
import { CHUNK_BYTES, createFileTransfer, TransferCancelled, type FileOffer, type TransferProgress, type ChatText, type ReceivedFile } from './fileTransfer';

export type PeerStatus = 'connecting' | 'connected' | 'closed' | 'failed';
type Options = {
  role: 'sender' | 'receiver';
  sendSignal: (signal: RtcSignal) => boolean;
  onStatus: (status: PeerStatus) => void;
  onRoute?: (route: ConnectionRoute) => void;
  onError: (message: string) => void;
  onText: (message: ChatText) => void;
  onOffer: (offer: FileOffer | null) => void;
  onProgress: (progress: TransferProgress) => void;
  onFile: (file: ReceivedFile) => void;
};

export function createPeerConnection(options: Options) {
  const peer = new RTCPeerConnection();
  const configured = loadIceConfiguration().then(config => { if (!closed) peer.setConfiguration(config); });
  void configured.catch(error => fail(error instanceof Error ? error.message : 'Connection configuration unavailable'));
  let channel: RTCDataChannel | null = null;
  let closed = false;
  let started = false;
  let signalChain = Promise.resolve();
  let pendingSignals = 0;
  const candidates: RTCIceCandidateInit[] = [];
  const abort = new AbortController();
  let incomingChain = Promise.resolve();
  let incomingBytes = 0;
  let incomingCount = 0;
  let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const setupTimer = setTimeout(() => fail('WebRTC connection timed out. Check STUN/TURN configuration for this network.'), 30_000);

  function close(status: PeerStatus = 'closed') {
    if (closed) return;
    closed = true;
    clearTimeout(setupTimer); clearTimeout(disconnectTimer);
    abort.abort();
    transfer.close();
    channel?.close(); peer.close();
    options.onStatus(status);
  }
  function fail(message: string) {
    if (closed) return;
    options.onError(message); close('failed');
  }
  function sendControl(message: object) {
    if (closed || channel?.readyState !== 'open') throw new Error('DataChannel is not open');
    if (channel.bufferedAmount > 512 * 1024) throw new Error('DataChannel is busy');
    const text = JSON.stringify(message);
    if (new TextEncoder().encode(text).byteLength > (peer.sctp?.maxMessageSize || 65536)) throw new Error('Control message exceeds the negotiated size');
    channel.send(text);
  }
  async function waitForBuffer() {
    const current = channel;
    if (!current || current.readyState !== 'open' || closed) throw new Error('DataChannel closed');
    if (current.bufferedAmount <= 256 * 1024) return;
    await new Promise<void>((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer); current.removeEventListener('bufferedamountlow', low);
        current.removeEventListener('close', stopped); abort.signal.removeEventListener('abort', stopped);
      };
      const low = () => { clean(); resolve(); };
      const stopped = () => { clean(); reject(new Error('DataChannel closed')); };
      const timer = setTimeout(() => { clean(); reject(new Error('DataChannel stalled')); }, 30_000);
      current.addEventListener('bufferedamountlow', low);
      current.addEventListener('close', stopped); abort.signal.addEventListener('abort', stopped, { once: true });
      if (current.readyState !== 'open' || closed) stopped();
      else if (current.bufferedAmount <= current.bufferedAmountLowThreshold) low();
    });
  }
  const transfer = createFileTransfer({
    ...options,
    sendControl,
    chunkSize: () => Math.min(CHUNK_BYTES, peer.sctp?.maxMessageSize || CHUNK_BYTES),
    sendChunk: async data => {
      await waitForBuffer();
      if (closed || channel?.readyState !== 'open') throw new Error('DataChannel closed');
      channel.send(data);
    },
    onFile: file => { if (!closed) options.onFile(file); else void file.dispose?.(); },
  });

  function attachChannel(next: RTCDataChannel) {
    if (closed || channel || next.label !== 'peer-share' || !next.ordered
        || next.maxRetransmits !== null || next.maxPacketLifeTime !== null) {
      next.close(); fail('Unexpected DataChannel'); return;
    }
    channel = next; next.binaryType = 'arraybuffer'; next.bufferedAmountLowThreshold = 64 * 1024;
    next.onopen = () => {
      if (closed) return;
      clearTimeout(setupTimer); options.onStatus('connected');
      void peer.getStats().then(reports => {
        if (!closed) options.onRoute?.(selectedConnectionRoute(reports));
      }).catch(() => { if (!closed) options.onRoute?.('unknown'); });
    };
    next.onclose = () => close();
    next.onerror = () => fail('DataChannel failed');
    next.onmessage = event => {
      if (closed) return;
      const data: unknown = event.data;
      if (typeof data !== 'string' && !(data instanceof ArrayBuffer)) { fail('Unexpected peer data'); return; }
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
      incomingBytes += bytes; incomingCount++;
      if (incomingBytes > 1024 * 1024 || incomingCount > 128) { fail('Peer receive queue limit exceeded'); return; }
      incomingChain = incomingChain.then(async () => {
        if (!closed) await transfer.receive(data);
      }).catch(error => fail(error instanceof Error ? 'File receive failed: ' + error.message : 'Invalid or incomplete data received from peer')).finally(() => { incomingBytes -= bytes; incomingCount--; });
    };
  }
  peer.ondatachannel = event => {
    if (options.role !== 'receiver') { event.channel.close(); fail('Unexpected incoming channel'); }
    else attachChannel(event.channel);
  };
  peer.onicecandidate = event => {
    if (!closed && event.candidate && !options.sendSignal({ type: 'ice-candidate', candidate: { ...event.candidate.toJSON(), candidate: event.candidate.candidate } })) fail('Signaling connection unavailable');
  };
  peer.onconnectionstatechange = () => {
    if (closed) return;
    clearTimeout(disconnectTimer);
    if (peer.connectionState === 'failed') fail('WebRTC connection failed. This network may require TURN.');
    else if (peer.connectionState === 'disconnected') disconnectTimer = setTimeout(() => fail('Peer disconnected'), 10_000);
  };
  options.onStatus('connecting');

  return {
    async start() {
      if (started || closed || options.role !== 'sender') return;
      started = true;
      try {
        await configured;
        if (closed) return;
        attachChannel(peer.createDataChannel('peer-share', { ordered: true }));
        await peer.setLocalDescription(await peer.createOffer());
        if (!closed && !options.sendSignal({ type: 'offer', sdp: peer.localDescription!.sdp })) fail('Could not send WebRTC offer');
      } catch { fail('Could not create WebRTC offer'); }
    },
    handleSignal(signal: RtcSignal) {
      if (closed) return;
      if (++pendingSignals > 256) { fail('Too many WebRTC setup messages'); return; }
      signalChain = signalChain.then(async () => {
        await configured;
        if (closed) return;
        if (signal.type === 'ice-candidate') {
          if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
          else { if (candidates.length >= 128) throw new Error('Too many candidates'); candidates.push(signal.candidate); }
          return;
        }
        if ((signal.type === 'offer' && (options.role !== 'receiver' || peer.signalingState !== 'stable' || peer.remoteDescription))
            || (signal.type === 'answer' && (options.role !== 'sender' || peer.signalingState !== 'have-local-offer'))) throw new Error('Unexpected SDP');
        await peer.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
        while (candidates.length && !closed) await peer.addIceCandidate(candidates.shift()!);
        if (signal.type === 'offer') {
          await peer.setLocalDescription(await peer.createAnswer());
          if (!closed && !options.sendSignal({ type: 'answer', sdp: peer.localDescription!.sdp })) throw new Error('Signaling unavailable');
        }
      }).catch(() => fail('WebRTC setup message could not be processed')).finally(() => { pendingSignals--; });
    },
    sendText(text: string, id: string = crypto.randomUUID()): ChatText | null {
      try { if (!text.trim() || text.length > 2000) return null; const message = { id, text }; sendControl({ type: 'text', ...message }); return message; }
      catch { options.onError('The connection is not ready or is busy'); return null; }
    },
    async sendFile(file: File) {
      try { await transfer.sendFile(file); }
      catch (error) { if (!closed && !(error instanceof TransferCancelled)) fail(error instanceof Error ? error.message : 'File transfer failed'); }
    },
    cancelFile: (direction: 'send' | 'receive') => transfer.cancelFile(direction),
    acceptFile(accept: boolean) {
      try { void transfer.acceptFile(accept).catch(error => options.onError(error instanceof Error ? error.message : 'Could not prepare file storage')); }
      catch { fail('Could not respond to the file offer'); }
    },
    close: () => close(),
  };
}
