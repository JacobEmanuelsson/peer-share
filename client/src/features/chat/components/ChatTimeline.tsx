import { useEffect, useRef } from 'react';
import { HISTORY_LIMIT, type ChatEntry } from '../chatHistory';

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const statusLabel = { waiting: 'Offered', transferring: 'Transferring', verifying: 'Verifying', complete: 'Complete', declined: 'Declined', interrupted: 'Interrupted', cancelled: 'Cancelled', failed: 'Failed' };
export default function ChatTimeline({ entries, downloads, loading, error, onClear, group = false }: {
  entries: ChatEntry[]; downloads: Record<string, string>; loading: boolean; error: string; onClear: () => void; group?: boolean;
}) {
  const log = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    if (atBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [entries]);
  return <>
    <div className="chat-toolbar"><p className="micro-copy">Last {HISTORY_LIMIT} entries · Saved on this device</p>
      <button className="text-button" type="button" disabled={loading || !entries.length} onClick={() => { if (window.confirm('Clear this conversation’s history on this device?')) onClear(); }}>Clear history</button></div>
    {loading ? <p role="status" className="micro-copy">Loading chat history…</p> : null}
    {error ? <p role="alert" className="error-message">{error} New messages remain visible for this session.</p> : null}
    <div className="chat-log" role="log" aria-label="Chat history" aria-live="polite" aria-relevant="additions text" ref={log}
      onScroll={() => { const node = log.current!; atBottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < 60; }}>
      {!entries.length && !loading ? <div className="chat-empty">Start a conversation. Messages and file activity will appear here.</div> : null}
      {entries.map(entry => <article className={'chat-entry ' + (entry.direction === 'send' ? 'chat-outgoing' : 'chat-incoming')} key={entry.key} data-chat-kind={entry.kind}>
        <header className="chat-meta"><strong title={entry.sender.id}>{entry.direction === 'send' ? 'You · ' : ''}{entry.sender.name}</strong>
          <time dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleString()}>{date.format(entry.at)}</time></header>
        {entry.kind === 'text' ? <p className="chat-body">{entry.text}</p> : <div className="chat-file">
          <p className="chat-file-name"><span aria-hidden="true">↗</span> {entry.file.name}</p>
          <p className="micro-copy">{entry.file.size.toLocaleString()} bytes · {statusLabel[entry.file.status]}</p>
          {downloads[entry.key] ? <a className="verified-download" href={downloads[entry.key]} download={entry.file.name}>Download {entry.file.name}{group ? ' from ' + entry.sender.name : ''} (verified)</a> :
            entry.direction === 'receive' && entry.file.status === 'complete' ? <p className="micro-copy">File data is no longer held in this session.</p> : null}
        </div>}
        <p className="chat-audience">{entry.direction === 'send' ? 'Sent to ' : 'To '}{entry.recipients.map(person => person.name).join(', ')}</p>
      </article>)}
    </div>
    <p className="chat-local-note">History is private to this account on this browser. Times reflect activity on this device. File downloads are temporary; saved history contains details only.</p>
  </>;
}