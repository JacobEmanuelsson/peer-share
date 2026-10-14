export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type Handlers = {
  onStatus: (status: ConnectionStatus) => void;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
};

export function connectSignaling(handlers: Handlers) {
  const url = new URL('/api/signaling', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  let disposed = false;

  handlers.onStatus('connecting');
  socket.addEventListener('open', () => {
    if (!disposed) handlers.onStatus('connected');
  });
  socket.addEventListener('message', (event) => {
    if (!disposed && typeof event.data === 'string') handlers.onMessage(event.data);
  });
  socket.addEventListener('error', () => {
    if (!disposed) handlers.onError('WebSocket connection failed.');
  });
  socket.addEventListener('close', () => {
    if (!disposed) handlers.onStatus('disconnected');
  });

  return {
    send(message: string): boolean {
      if (disposed || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(message);
      return true;
    },
    close() {
      disposed = true;
      socket.close();
    },
  };
}
