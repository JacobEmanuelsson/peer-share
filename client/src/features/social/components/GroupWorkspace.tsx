import { connectionRouteLabel, type ConnectionRoute } from '../../../webrtc/connectionRoute';
import ChatTimeline from '../../chat/components/ChatTimeline';
import { useChatHistory } from '../../chat/useChatHistory';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { connectGroup, type GroupPeer } from '../api/groupConnection';
import { socialRequest, socialSchema } from '../api/socialClient';
import { MAX_FILE_BYTES, type FileOffer, type TransferProgress } from '../../../webrtc/fileTransfer';
import type { PeerStatus } from '../../../webrtc/peerConnection';

type PeerState = { status?: PeerStatus; route?: ConnectionRoute; offer?: FileOffer | null; send?: TransferProgress; receive?: TransferProgress; busy?: boolean };
export default function GroupWorkspace({ groupId, userId, userName, onLeave }: { groupId: string; userId: string; userName: string; onLeave: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [peers, setPeers] = useState<GroupPeer[]>([]);
  const [states, setStates] = useState<Record<string, PeerState>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [ended, setEnded] = useState(false);
  const connection = useRef<ReturnType<typeof connectGroup> | null>(null);
  const chat = useChatHistory({ id: userId, name: userName.slice(0, 100) }, 'group:' + groupId);
  const social = useQuery({ queryKey: ['social', userId], queryFn: async ({ signal }) => socialSchema.parse(await socialRequest('/api/social', 'GET', undefined, signal)) });
  const group = social.data?.groups.find(item => item.id === groupId);
  useEffect(() => {
    const patch = (id: string, update: Partial<PeerState>) => setStates(previous => ({ ...previous, [id]: { ...previous[id], ...update } }));
    const people = new Map<string, GroupPeer>();
    const session = connectGroup(groupId, {
      onRoster: next => {
        people.clear(); next.forEach(peer => people.set(peer.id, peer));
        setPeers(next);
        setStates(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => next.some(peer => peer.id === id))));
        setSelected(previous => previous.filter(id => next.some(peer => peer.id === id)));
      },
      onRoute: (id, route) => patch(id, { route }),
      onStatus: (id, status) => patch(id, { status, ...(status === 'closed' || status === 'failed' ? { offer: null, busy: false } : {}) }),
      onOffer: (id, offer) => {
        patch(id, { offer });
        const peer = people.get(id);
        if (offer && peer) chat.addFile({ id: offer.id, direction: 'receive', name: offer.name, bytes: 0, total: offer.size, status: 'waiting' }, { id: peer.userId, name: peer.name });
      },
      onProgress: (id, progress) => {
        patch(id, { [progress.direction]: progress });
        const peer = people.get(id);
        if (peer) chat.addFile(progress, { id: peer.userId, name: peer.name });
      },
      onFile: (id, received) => {
        const peer = people.get(id); if (!peer) { void received.dispose?.(); return; }
        const person = { id: peer.userId, name: peer.name };
        chat.addFile({ id: received.id, direction: 'receive', name: received.name, bytes: received.blob.size, total: received.blob.size, status: 'complete' }, person);
        chat.attachDownload(received, person);
      },
      onText: (id, message) => {
        const peer = people.get(id);
        if (peer) chat.addText(message, { id: peer.userId, name: peer.name }, 'receive');
      },
      onError: setError,
      onDisconnected: () => { setEnded(true); setStates({}); setPeers([]); },
    });
    connection.current = session;
    return () => { connection.current = null; session.close(); };
  }, [groupId, attempt, chat.addFile, chat.addText, chat.attachDownload]);

  const ready = selected.filter(id => states[id]?.status === 'connected' && !states[id]?.busy);
  async function sendSelected() {
    if (!file || !ready.length) return;
    if (file.size > MAX_FILE_BYTES) { setError('Choose a file of at most 1 GiB.'); return; }
    setError('');
    const session = connection.current!;
    const ids = [...ready];
    setStates(previous => Object.fromEntries(Object.entries(previous).map(([id, state]) => [id, ids.includes(id) ? { ...state, busy: true } : state])));
    await Promise.all(ids.map(async id => {
      await session.sendFile(id, file);
      if (connection.current === session) setStates(previous => previous[id] ? { ...previous, [id]: { ...previous[id], busy: false } } : previous);
    }));
  }
  return <section className="group-workspace" aria-labelledby="group-session-heading">
    <div className="workspace-toolbar"><h2 id="group-session-heading">Group: {group?.name ?? 'Sharing session'}</h2><button className="button button-secondary button-small" onClick={onLeave}>Leave session</button></div>
    <p className="inline-notice" role="status">{ended ? 'Group session ended. Leave and rejoin to reconnect.' : peers.length ? peers.length + ' other members online. Select connected recipients below.' : 'Group session joined. Waiting for other members to join.'}</p>
    <section className="panel">
      <h3>Send to your group</h3><p className="panel-description">Select connected members. Each recipient accepts independently. Up to 1 GiB per file; your upload is repeated for every selected person.</p>
      <div className="social-form"><label className="file-picker">Choose a group file<input type="file" aria-label="Group file to send" disabled={ended} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
        <button className="button" disabled={!file || !ready.length || ended} onClick={() => void sendSelected()}>Send to selected ({ready.length})</button></div>
      {file ? <p className="micro-copy break-id">{file.name}</p> : null}
    </section>
    <button className="button button-secondary" onClick={() => { setEnded(false); setStates({}); setPeers([]); setError(""); setAttempt(value => value + 1); }}>Reconnect group</button>
    <div className="button-row">{peers.flatMap(peer => (['send', 'receive'] as const).map(direction => {
      const progress = states[peer.id]?.[direction];
      return progress && !['complete', 'declined', 'failed', 'interrupted', 'cancelled'].includes(progress.status)
        ? <button className="text-button" key={peer.id + direction} onClick={() => connection.current?.cancelFile(peer.id, direction)}>Cancel {direction === 'send' ? 'sending to ' : 'receiving from '}{peer.name}</button> : null;
    }))}</div>
    <section className="panel chat-panel" aria-labelledby="group-chat-heading">
      <div className="panel-heading"><h3 id="group-chat-heading">Group chat</h3><span className="micro-copy">{peers.filter(peer => states[peer.id]?.status === 'connected').length} CONNECTED RECIPIENTS</span></div>
      <ChatTimeline entries={chat.entries} downloads={chat.downloads} loading={chat.loading} error={chat.storageError} onClear={chat.clear} group />
      <form className="chat-composer" onSubmit={event => {
        event.preventDefault();
        if (!text.trim()) return;
        const id = crypto.randomUUID();
        const targets = peers.filter(peer => states[peer.id]?.status === 'connected');
        const sent = targets.filter(peer => connection.current?.sendText(peer.id, text, id));
        if (!sent.length) { setError('No connected member could receive this message.'); return; }
        const recipients = sent.map(peer => ({ id: peer.userId, name: peer.name }));
        chat.addText({ id, text }, recipients[0], 'send', recipients);
        if (sent.length !== targets.length) setError('Some members could not receive the message. The chat entry lists the recipients it was sent to.');
        setText('');
      }}>
        <textarea aria-label="Group message" placeholder="Message connected group members…" value={text} maxLength={2000} rows={2} onChange={event => setText(event.target.value)} required disabled={ended}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (text.trim()) event.currentTarget.form?.requestSubmit(); } }} />
        <button className="button" disabled={ended || !peers.some(peer => states[peer.id]?.status === 'connected') || !text.trim()}>Send group message</button>
      </form>
      <p className="micro-copy">Messages go to all connected members, independently of file selection. Offline members do not receive them.</p>
    </section>
    <div className="group-peer-grid">{peers.map(peer => {
      const state = states[peer.id] ?? {};
      return <section className="panel" key={peer.id} aria-label={'Group peer ' + peer.name}>
        <div className="panel-heading"><h3>{peer.name}</h3><p className="micro-copy" role="status">WebRTC: {state.status ?? 'connecting'}</p></div>
        {state.status === 'connected' ? <p className="micro-copy">Connection route: {connectionRouteLabel(state.route ?? 'unknown')}</p> : null}
        <label className="member-choice"><input type="checkbox" aria-label={'Send to ' + peer.name} checked={selected.includes(peer.id)} disabled={state.status !== 'connected' || state.busy}
          onChange={event => setSelected(previous => event.target.checked ? [...previous, peer.id] : previous.filter(id => id !== peer.id))} /> Include in send</label>
        {state.offer ? <div className="file-offer"><p className="break-id">Incoming file: {state.offer.name} ({state.offer.size} bytes)</p><div className="button-row">
          <button className="button button-small" onClick={() => connection.current?.acceptFile(peer.id, true)}>Accept file from {peer.name}</button>
          <button className="button button-secondary button-small" onClick={() => connection.current?.acceptFile(peer.id, false)}>Decline file from {peer.name}</button></div></div> : null}
        {[state.send, state.receive].map(progress => progress ? <div className="transfer-progress" key={progress.direction} aria-live="polite">
          <p>{progress.direction === 'send' ? 'Sending' : 'Receiving'} {progress.name}: {progress.status}</p>
          <progress aria-label={peer.name + ' ' + progress.direction + ' progress'} max={progress.total || 1} value={progress.total ? progress.bytes : progress.status === 'complete' ? 1 : 0} />
        </div> : null)}
      </section>;
    })}</div>
    {group ? <p className="micro-copy">Saved members: {group.members.map(member => member.name).join(', ')}. A member appears above after joining this live session.</p> : null}
    {error ? <p className="error-message" role="alert">{error}</p> : null}
  </section>;
}