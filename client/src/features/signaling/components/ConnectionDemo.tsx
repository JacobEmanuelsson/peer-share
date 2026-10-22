import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  connectSignaling,
  type ClientMessage,
  type ConnectionStatus,
  type ServerMessage,
} from '../api/signalingClient';

type IncomingInvitation = Extract<ServerMessage, { type: 'invitation-received' }>;
type OutgoingInvitation = Extract<ServerMessage, { type: 'invitation-created' }>;
type Pair = Extract<ServerMessage, { type: 'invitation-accepted' }>;

const inputClass = 'w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100';
const buttonClass = 'rounded bg-teal-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50';

export default function ConnectionDemo({ userId }: { userId: string }) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [recipientId, setRecipientId] = useState('');
  const [incoming, setIncoming] = useState<IncomingInvitation[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingInvitation | null>(null);
  const [pair, setPair] = useState<Pair | null>(null);
  const [text, setText] = useState('');
  const [received, setReceived] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const pairRef = useRef<Pair | null>(null);
  const connectionRef = useRef<ReturnType<typeof connectSignaling> | null>(null);

  useEffect(() => {
    const connection = connectSignaling({
      onStatus(nextStatus) {
        setStatus(nextStatus);
        if (nextStatus === 'connected') setError('');
        if (nextStatus === 'disconnected') {
          pairRef.current = null;
          setPair(null);
          setIncoming([]);
          setOutgoing(null);
          setPending(null);
          setReceived([]);
          setText('');
          setNotice('Disconnected. Refresh this page to reconnect.');
        }
      },
      onMessage(message) {
        switch (message.type) {
          case 'invitation-created':
            setOutgoing(message);
            setPending(null);
            setNotice('Invitation sent. Waiting for the recipient to accept.');
            break;
          case 'invitation-received':
            setIncoming(previous => [...previous.filter(item => item.invitationId !== message.invitationId), message]);
            break;
          case 'invitation-accepted':
            pairRef.current = message;
            setPair(message);
            setPending(null);
            setOutgoing(null);
            setIncoming(previous => previous.filter(item => item.invitationId !== message.invitationId));
            setReceived([]);
            setNotice(`Paired as ${message.role}. You can now send text.`);
            break;
          case 'invitation-accepted-elsewhere':
            setIncoming(previous => previous.filter(item => item.invitationId !== message.invitationId));
            setPending(previous => previous === message.invitationId ? null : previous);
            setNotice('This invitation was accepted in another tab or device.');
            break;
          case 'peer-message':
            if (pairRef.current?.pairId === message.pairId) {
              setReceived(previous => [...previous.slice(-19), message.text]);
            }
            break;
          case 'pair-ended':
            if (pairRef.current?.pairId === message.pairId) {
              pairRef.current = null;
              setPair(null);
              setText('');
              setPending(null);
              setNotice('Your peer disconnected. Create a new invitation to pair again.');
            }
            break;
          case 'error':
            setPending(null);
            setError(message.text);
            break;
        }
      },
      onError(message) { setPending(null); setError(message); },
    });
    connectionRef.current = connection;
    // Keeps expiry labels current without changing backend authority over deadlines.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      connectionRef.current = null;
      pairRef.current = null;
      connection.close();
    };
  }, []);

  function send(message: ClientMessage): boolean {
    setError('');
    if (!connectionRef.current?.send(message)) {
      setError('The connection is not ready.');
      return false;
    }
    return true;
  }

  function handleInvite(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || pair || status !== 'connected') return;
    const recipientUserId = recipientId.trim();
    if (!recipientUserId) { setError('Enter a recipient account ID.'); return; }
    if (send({ type: 'create-invitation', recipientUserId })) setPending('invite');
  }

  function handleAccept(invitation: IncomingInvitation) {
    if (pending || pair || status !== 'connected') return;
    if (invitation.expiresAt <= Date.now()) { setError('This invitation has expired.'); return; }
    if (send({ type: 'accept-invitation', invitationId: invitation.invitationId })) {
      setPending(invitation.invitationId);
    }
  }

  function handleSend(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pair || status !== 'connected' || !text.trim()) return;
    if (send({ type: 'peer-message', pairId: pair.pairId, text })) setText('');
  }

  return (
    <section className="mt-8 space-y-6 rounded border border-slate-700 p-5" aria-labelledby="connection-heading">
      <h2 id="connection-heading" className="text-xl font-semibold">Peer connection</h2>
      <p role="status">Connection: {status}</p>
      <p className="text-sm text-slate-300">Your account ID: <code className="break-all select-all">{userId}</code></p>
      <p className="text-sm text-slate-300">Share your account ID with the sender. To try another tab on your account, enter your own ID.</p>

      <form onSubmit={handleInvite} className="space-y-3">
        <label htmlFor="recipient-id" className="block">Recipient account ID</label>
        <input id="recipient-id" value={recipientId} onChange={event => setRecipientId(event.target.value)}
          className={inputClass} maxLength={128} required disabled={Boolean(pair) || status !== 'connected'} />
        <button type="submit" className={buttonClass}
          disabled={status !== 'connected' || Boolean(pair) || Boolean(pending)}>
          {pending === 'invite' ? 'Inviting…' : 'Invite'}
        </button>
      </form>
      {outgoing ? <p role="status">{outgoing.expiresAt <= now ? 'Invitation expired. You can send a new one.' : `Waiting for account ${outgoing.recipientUserId} to accept.`}</p> : null}

      <section aria-labelledby="invitations-heading" className="space-y-3">
        <h3 id="invitations-heading" className="font-semibold">Incoming invitations</h3>
        {incoming.length === 0 ? <p className="text-slate-300">No incoming invitations.</p> : (
          <ul className="space-y-3">
            {incoming.map(invitation => (
              <li key={invitation.invitationId} className="space-y-2 rounded border border-slate-700 p-3">
                <p className="break-all">From account: {invitation.senderUserId}</p>
                <p className="text-sm text-slate-300">{invitation.expiresAt <= now ? 'Expired' : 'Waiting for your acceptance'}</p>
                <button type="button" className={buttonClass} onClick={() => handleAccept(invitation)}
                  disabled={status !== 'connected' || Boolean(pair) || Boolean(pending) || invitation.expiresAt <= now}>
                  {pending === invitation.invitationId ? 'Accepting…' : 'Accept invitation'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p role="status">{notice}</p>
      <form onSubmit={handleSend} className="space-y-3">
        <label htmlFor="peer-text" className="block">Message to your peer</label>
        <input id="peer-text" className={inputClass} value={text} onChange={event => setText(event.target.value)}
          maxLength={200} required disabled={!pair || status !== 'connected'} />
        <button type="submit" className={buttonClass} disabled={!pair || status !== 'connected' || !text.trim()}>Send message</button>
      </form>
      <section aria-labelledby="received-heading" className="space-y-2">
        <h3 id="received-heading" className="font-semibold">Received messages</h3>
        <ul aria-live="polite">{received.map((message, index) => <li key={index} className="break-words">{message}</li>)}</ul>
      </section>
      {error ? <p role="alert">{error}</p> : null}
      <p className="text-sm text-slate-400">Text currently travels through the server. WebRTC file transfer comes later.</p>
    </section>
  );
}
