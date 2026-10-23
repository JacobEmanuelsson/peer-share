import ChatTimeline from '../../chat/components/ChatTimeline';
import { useChatHistory } from '../../chat/useChatHistory';
import type { Person } from '../../chat/chatHistory';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  connectSignaling,
  type ClientMessage,
  type ConnectionStatus,
  type ServerMessage,
} from '../api/signalingClient';

import { createPeerConnection, type PeerStatus } from '../../../webrtc/peerConnection';
import { MAX_FILE_BYTES, type FileOffer, type TransferProgress } from '../../../webrtc/fileTransfer';

type IncomingInvitation = Extract<ServerMessage, { type: 'invitation-received' }>;
type OutgoingInvitation = Extract<ServerMessage, { type: 'invitation-created' }>;
type Pair = Extract<ServerMessage, { type: 'invitation-accepted' }>;


export default function ConnectionDemo({ userId, userName, quickInvite, chatTarget }: { userId: string; userName: string; quickInvite?: { userId: string; nonce: number }; chatTarget?: Person }) {
  const [attempt, setAttempt] = useState(0);
  const lastQuickInvite = useRef<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [copied, setCopied] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const [incoming, setIncoming] = useState<IncomingInvitation[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingInvitation | null>(null);
  const [pair, setPair] = useState<Pair | null>(null);
  const [text, setText] = useState('');
  const [chatPeer, setChatPeer] = useState<Person | null>(null);
  const chat = useChatHistory({ id: userId, name: userName.slice(0, 100) }, chatPeer ? 'peer:' + chatPeer.id : null);
  const chatRef = useRef(chat); chatRef.current = chat;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [rtcStatus, setRtcStatus] = useState<PeerStatus | 'idle'>('idle');
  const [fileOffer, setFileOffer] = useState<FileOffer | null>(null);
  const [progress, setProgress] = useState<Partial<Record<TransferProgress['direction'], TransferProgress>>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sendingFile, setSendingFile] = useState(false);
  const peerRef = useRef<ReturnType<typeof createPeerConnection> | null>(null);
  const pairRef = useRef<Pair | null>(null);
  const connectionRef = useRef<ReturnType<typeof connectSignaling> | null>(null);

  useEffect(() => {
    function clearPeer() {
      peerRef.current?.close();
      peerRef.current = null;
      setRtcStatus('idle');
      setFileOffer(null);
      setProgress({});
      setSendingFile(false);
      setSelectedFile(null);
    }
    const connection = connectSignaling({
      onStatus(nextStatus) {
        setStatus(nextStatus);
        if (nextStatus === 'connected') setError('');
        if (nextStatus === 'disconnected') {
          clearPeer();
          pairRef.current = null;
          setPair(null);
          setIncoming([]);
          setOutgoing(null);
          setPending(null);
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
            setIncoming(previous => [...previous.filter(item => item.invitationId !== message.invitationId && item.expiresAt > Date.now()), message].slice(-100));
            break;
          case 'invitation-accepted':
            clearPeer();
            pairRef.current = message;
            setPair(message);
            setChatPeer(message.peer);
            setPending(null);
            setOutgoing(null);
            setIncoming(previous => previous.filter(item => item.invitationId !== message.invitationId));
            setNotice(`Paired as ${message.role}. Establishing the direct connection…`);
            try {
              const isCurrent = () => pairRef.current?.pairId === message.pairId;
              const peer = createPeerConnection({
                role: message.role,
                sendSignal: signal => isCurrent() && connection.send({ type: 'webrtc-signal', pairId: message.pairId, signal }),
                onStatus: next => {
                  if (!isCurrent()) return;
                  setRtcStatus(next);
                  if (next === 'closed' || next === 'failed') {
                    setFileOffer(null);
                    setProgress({});
                    setSendingFile(false);
                    setNotice('Direct connection ended. Refresh both peers to pair again.');
                  }
                },
                onError: text => { if (isCurrent()) setError(text); },
                onText: text => { if (isCurrent()) chatRef.current.addText(text, message.peer, 'receive'); },
                onOffer: offer => {
                  if (!isCurrent()) return;
                  setFileOffer(offer);
                  if (offer) chatRef.current.addFile({ id: offer.id, direction: 'receive', name: offer.name, total: offer.size, bytes: 0, status: 'waiting' }, message.peer);
                },
                onProgress: next => {
                  if (!isCurrent()) return;
                  setProgress(previous => ({ ...previous, [next.direction]: next }));
                  chatRef.current.addFile(next, message.peer);
                },
                onFile: file => {
                  if (!isCurrent()) { void file.dispose?.(); return; }
                  chatRef.current.addFile({ id: file.id, direction: 'receive', name: file.name, total: file.blob.size, bytes: file.blob.size, status: 'complete' }, message.peer);
                  chatRef.current.attachDownload(file, message.peer);
                },
              });
              peerRef.current = peer;
              void peer.start();
            } catch { setRtcStatus('failed'); setError('Could not initialize WebRTC in this browser.'); }
            break;
          case 'invitation-accepted-elsewhere':
            setIncoming(previous => previous.filter(item => item.invitationId !== message.invitationId));
            setPending(previous => previous === message.invitationId ? null : previous);
            setNotice('This invitation was accepted in another tab or device.');
            break;
          case 'webrtc-signal':
            if (pairRef.current?.pairId === message.pairId) peerRef.current?.handleSignal(message.signal);
            break;
          case 'pair-ended':
            if (pairRef.current?.pairId === message.pairId) {
              clearPeer();
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
      clearPeer();
      connectionRef.current = null;
      pairRef.current = null;
      connection.close();
    };
  }, [attempt]);

  useEffect(() => {
    if (!quickInvite || lastQuickInvite.current === quickInvite.nonce || status !== 'connected') return;
    lastQuickInvite.current = quickInvite.nonce;
    setRecipientId(quickInvite.userId);
    if (pair || pending) { setError('Finish your current connection or invitation before inviting a friend.'); return; }
    setError('');
    if (connectionRef.current?.send({ type: 'create-invitation', recipientUserId: quickInvite.userId })) setPending('invite');
  }, [quickInvite, status, pair, pending]);

  useEffect(() => {
    if (!chatTarget) return;
    if (pairRef.current && pairRef.current.peer.id !== chatTarget.id) {
      setError('Finish your current connection before opening another conversation.');
      return;
    }
    setChatPeer(chatTarget);
  }, [chatTarget]);

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
    const sent = peerRef.current?.sendText(text);
    if (sent) { chat.addText(sent, pair.peer, 'send'); setText(''); }
  }

  const ready = rtcStatus === 'connected';
  return (
    <section className="sharing-workspace" aria-labelledby="connection-heading">
      <div className="workspace-toolbar">
        <button className="button button-secondary button-small" onClick={() => {
          if (pairRef.current) connectionRef.current?.send({ type: 'end-pair', pairId: pairRef.current.pairId });
          setPair(null); setPending(null); setOutgoing(null); setIncoming([]); setError('');
          setAttempt(value => value + 1);
        }}>Reconnect</button>
        <h2 id="connection-heading">Your connections <span className="count-badge">{pair ? '01' : '00'}</span></h2>
        <p className={`connection-status ${ready ? 'is-ready' : ''}`} role="status"><span className="status-dot" />{ready ? 'Direct connection established' : status === 'connected' ? 'Ready to connect' : 'Signaling: ' + status}</p>
      </div>
      <div className="workspace-grid">
        <aside className="connection-column">
          <section className="panel identity-panel">
            <p className="eyebrow">YOUR SHARING ID</p>
            <p className="panel-description">Give this ID to the person you want to connect with.</p>
            <div className="identity-code"><code>{userId}</code><button type="button" className="copy-button" aria-label="Copy account ID" onClick={async () => {
              try { await navigator.clipboard.writeText(userId); setCopied(true); }
              catch { setError('Could not copy. Select and copy your account ID.'); }
            }}>{copied ? 'Copied' : 'Copy'}</button></div>
            <p className="micro-copy">Each tab is a separate connection.</p>
          </section>
          <section className="panel">
            <div className="panel-heading"><span className="step-number">01</span><h3>Connect with someone</h3></div>
            <form onSubmit={handleInvite} className="stack-form">
              <label htmlFor="recipient-id">Recipient account ID</label>
              <input id="recipient-id" value={recipientId} onChange={event => setRecipientId(event.target.value)}
                placeholder="Paste their sharing ID" maxLength={128} required disabled={Boolean(pair) || status !== 'connected'} />
              <button type="submit" className="button" disabled={status !== 'connected' || Boolean(pair) || Boolean(pending)}>
                {pending === 'invite' ? 'Inviting…' : 'Invite'} <span aria-hidden="true">↗</span>
              </button>
            </form>
            {outgoing ? <p className="inline-notice" role="status">{outgoing.expiresAt <= now ? 'Invitation expired. You can send a new one.' : 'Invitation sent. Waiting for them to accept.'}</p> : null}
          </section>
          <section className="panel invitation-panel" aria-labelledby="invitations-heading">
            <div className="panel-heading"><h3 id="invitations-heading">Incoming invitations</h3><span className="count-badge">{incoming.filter(item => item.expiresAt > now).length}</span></div>
            {incoming.length === 0 ? <div className="small-empty"><span aria-hidden="true">↙</span><p>No incoming invitations.</p><p className="micro-copy">New connection requests appear here.</p></div> : (
              <ul className="invitation-list">{incoming.map(invitation => (
                <li key={invitation.invitationId}>
                  <p className="micro-copy">FROM ACCOUNT</p><p className="break-id">{invitation.senderUserId}</p>
                  <p className="micro-copy">{invitation.expiresAt <= now ? 'Expired' : 'Waiting for your acceptance'}</p>
                  <button type="button" className="button button-secondary" onClick={() => handleAccept(invitation)}
                    disabled={status !== 'connected' || Boolean(pair) || Boolean(pending) || invitation.expiresAt <= now}>
                    {pending === invitation.invitationId ? 'Accepting…' : 'Accept invitation'}
                  </button>
                </li>
              ))}</ul>
            )}
          </section>
        </aside>
        <div className="transfer-column">
          <section className={`panel transfer-panel ${ready ? 'is-connected' : ''}`} aria-labelledby="file-heading">
            <div className="panel-heading"><div><p className="eyebrow">DIRECT TO YOUR PERSON</p><h3 id="file-heading">A little less upload.<br />A lot more connection.</h3></div><span className="transport-badge">P2P</span></div>
            <div className="file-stage">
              <div className="file-symbol" aria-hidden="true"><span>↗</span></div>
              <h4>{ready ? 'Ready when you are.' : 'Your next transfer starts here.'}</h4>
              <p>{ready ? 'Choose a file and send it directly to your connected peer.' : 'Invite someone or accept an invitation to start sharing.'}</p>
              <form className="file-form" onSubmit={event => {
                event.preventDefault();
                if (!selectedFile || !peerRef.current || sendingFile || !ready) return;
                if (selectedFile.size > MAX_FILE_BYTES) { setError('Choose a file of at most 1 GiB.'); return; }
                setError(''); setSendingFile(true);
                void peerRef.current.sendFile(selectedFile).finally(() => setSendingFile(false));
              }}>
                <label htmlFor="transfer-file" className="file-picker">{selectedFile ? selectedFile.name : 'Choose a file'} <span aria-hidden="true">+</span>
                  <input id="transfer-file" aria-label="File to send" type="file" disabled={!ready || sendingFile}
                    onChange={event => setSelectedFile(event.target.files?.[0] ?? null)} />
                </label>
                <button className="button" type="submit" disabled={!ready || !selectedFile || sendingFile}>{sendingFile ? 'Sending…' : 'Send file'} <span aria-hidden="true">↗</span></button>
              </form>
              <p className="micro-copy">Up to 1 GiB per file · Either person can send</p>
            </div>
            {fileOffer ? <div className="file-offer">
              <p className="eyebrow">INCOMING FILE</p><p className="break-id">Incoming file: {fileOffer.name} ({fileOffer.size} bytes)</p>
              <div className="button-row"><button className="button" type="button" onClick={() => peerRef.current?.acceptFile(true)}>Accept file</button>
              <button className="button button-secondary" type="button" onClick={() => peerRef.current?.acceptFile(false)}>Decline file</button></div>
            </div> : null}
            {Object.values(progress).map(transfer => <div className="transfer-progress" aria-live="polite" key={transfer.direction}>
              <p>{transfer.direction === 'send' ? 'Sending' : 'Receiving'} {transfer.name}: {transfer.status} ({transfer.bytes}/{transfer.total} bytes)</p>
              {!['complete', 'declined', 'failed', 'interrupted', 'cancelled'].includes(transfer.status) ? <button className="text-button" type="button" onClick={() => peerRef.current?.cancelFile(transfer.direction)}>Cancel {transfer.direction === 'send' ? 'sending' : 'receiving'}</button> : null}
              <progress aria-label={transfer.direction === 'send' ? 'Sending file progress' : 'Receiving file progress'} max={transfer.total || 1} value={transfer.total ? transfer.bytes : transfer.status === 'complete' ? 1 : 0} />
            </div>)}
            <div className="transfer-footnote"><span className="status-dot" /><span>Encrypted in transit. File contents stay off our server.</span></div>
          </section>
          <section className="panel chat-panel" aria-labelledby="chat-heading">
            <div className="panel-heading"><h3 id="chat-heading">{chatPeer ? 'Chat with ' + chatPeer.name : 'Conversation'}</h3><span className="micro-copy">VIA DATA CHANNEL</span></div>
            <ChatTimeline entries={chat.entries} downloads={chat.downloads} loading={chat.loading} error={chat.storageError} onClear={chat.clear} />
            <form onSubmit={handleSend} className="chat-composer">
              <label htmlFor="peer-text" className="sr-only">Message to your peer</label>
              <textarea id="peer-text" value={text} onChange={event => setText(event.target.value)} placeholder="Write a message…" maxLength={2000} rows={2} required disabled={!ready}
                onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (text.trim()) event.currentTarget.form?.requestSubmit(); } }} />
              <button type="submit" className="button" disabled={!ready || !text.trim()}>Send message <span aria-hidden="true">↗</span></button>
            </form>
            <p className="micro-copy">Enter to send · Shift + Enter for a new line · {text.length}/2000</p>
          </section>
          {notice ? <p className="inline-notice" role="status">{notice}</p> : null}
          {error ? <p role="alert" className="error-message">{error}</p> : null}
          <details className="connection-details"><summary>Connection details</summary><p>Signaling: {status} · WebRTC: {rtcStatus}</p><p>The server introduces the selected browsers. Text and files use their encrypted WebRTC DataChannel.</p></details>
        </div>
      </div>
    </section>
  );
}