import { useEffect, useRef, useState } from 'react';
import { connectSignaling, type ConnectionStatus } from '../api/signalingClient';

export default function ConnectionDemo() {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const connectionRef = useRef<ReturnType<typeof connectSignaling> | null>(null);

  useEffect(() => {
    const connection = connectSignaling({
      onStatus: setStatus,
      onMessage: setMessage,
      onError: setError,
    });
    connectionRef.current = connection;
    return () => {
      connectionRef.current = null;
      connection.close();
    };
  }, []);

  function handleSend() {
    setError('');
    if (!connectionRef.current?.send(JSON.stringify({
      type: "peer-message",
      text: "Hello",
    }))) {
      setError('The connection is not ready.');
    }
  }

  return (
    <section className="mt-8 space-y-4 rounded border border-slate-700 p-4" aria-labelledby="connection-heading">
      <h2 id="connection-heading" className="text-xl font-semibold">Connection demo</h2>
      <p role="status">Status: {status}</p>
      <button type="button" onClick={handleSend} disabled={status !== 'connected'}
        className="rounded bg-teal-700 px-4 py-2 disabled:opacity-50">
        Send hello
      </button>
      {message ? <output className="block">{message}</output> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
