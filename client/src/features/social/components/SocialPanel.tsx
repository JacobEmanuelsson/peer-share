import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { socialRequest, socialSchema } from '../api/socialClient';

export default function SocialPanel({ userId, onInvite, onJoin, onChat, activeGroup }: {
  userId: string; onInvite: (id: string) => void; onJoin: (id: string) => void; activeGroup: string | null; onChat: (peer: { id: string; name: string }) => void;
}) {
  const client = useQueryClient();
  const [recipient, setRecipient] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const query = useQuery({
    queryKey: ['social', userId],
    queryFn: async ({ signal }) => socialSchema.parse(await socialRequest('/api/social', 'GET', undefined, signal)),
    refetchInterval: 5000,
  });
  const action = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: string; body?: object }) => socialRequest(path, method, body),
    onSuccess: async () => { setNotice('Saved.'); await client.invalidateQueries({ queryKey: ['social', userId] }); },
  });
  const friends = query.data?.friends.filter(friend => friend.status === 'accepted') ?? [];
  const requests = query.data?.friends.filter(friend => friend.status === 'pending') ?? [];
  return <section className="social-panel" aria-labelledby="people-heading">
    <div className="workspace-toolbar"><h2 id="people-heading">Your people & groups</h2><span className="micro-copy">SAVED TO YOUR ACCOUNT</span></div>
    {query.isPending ? <p role="status">Loading your people…</p> : null}
    {query.error ? <p role="alert" className="error-message">{query.error.message} <button className="button button-small" onClick={() => void query.refetch()}>Retry</button></p> : null}
    <div className="social-grid">
      <section className="panel" aria-labelledby="friends-heading">
        <div className="panel-heading"><h3 id="friends-heading">Friends</h3><span className="count-badge">{friends.length}</span></div>
        <form className="social-form" onSubmit={event => { event.preventDefault(); setNotice(''); action.mutate({ path: '/api/friends', method: 'POST', body: { recipientId: recipient.trim() } }, { onSuccess: () => setRecipient('') }); }}>
          <label className="sr-only" htmlFor="friend-id">Friend account ID</label>
          <input id="friend-id" placeholder="Their account ID" value={recipient} maxLength={128} required onChange={event => setRecipient(event.target.value)} />
          <button className="button button-small" disabled={action.isPending}>Add friend</button>
        </form>
        <button className="text-button" disabled={action.isPending || !recipient.trim()} onClick={() => action.mutate({ path: '/api/blocks', method: 'POST', body: { recipientId: recipient.trim() } })}>Block entered account</button>
        <ul className="people-list">{query.data?.blocks.map(block => <li key={block.id}><span>{block.name}</span><button className="text-button" disabled={action.isPending} onClick={() => action.mutate({ path: '/api/blocks/' + encodeURIComponent(block.id), method: 'DELETE' })}>Unblock {block.name}</button></li>)}</ul>
        <p className="micro-copy">They accept your request before you become friends.</p>
        <ul className="people-list">{friends.map(friend => <li key={friend.id}>
          <div><strong>{friend.peer.name}</strong><span className="micro-copy break-id">{friend.peer.id}</span></div>
          <div className="button-row"><button className="button button-small" onClick={() => onInvite(friend.peer.id)}>Invite {friend.peer.name}</button>
          <button className="text-button" onClick={() => onChat(friend.peer)}>Chat with {friend.peer.name}</button>
          <button className="text-button" disabled={action.isPending} onClick={() => action.mutate({ path: '/api/friends/' + friend.id, method: 'DELETE' })}>Remove</button><button className="text-button" disabled={action.isPending} onClick={() => { if (window.confirm("Block this account and end existing connections?")) action.mutate({ path: "/api/blocks", method: "POST", body: { recipientId: friend.peer.id } }); }}>Block {friend.peer.name}</button></div>
        </li>)}</ul>
        {!friends.length ? <p className="micro-copy">Your accepted friends appear here for quick invitations.</p> : null}
        {requests.length ? <div className="friend-requests"><h4>Friend requests</h4><ul className="people-list">{requests.map(request => <li key={request.id}>
          <div><strong>{request.peer.name}</strong><span className="micro-copy">{request.incoming ? 'Wants to be your friend' : 'Request sent'}</span></div>
          <div className="button-row">{request.incoming ? <button className="button button-small" disabled={action.isPending} onClick={() => action.mutate({ path: '/api/friends/' + request.id + '/accept', method: 'POST' })}>Accept {request.peer.name}</button> : null}

          <button className="text-button" disabled={action.isPending} onClick={() => action.mutate({ path: '/api/friends/' + request.id, method: 'DELETE' })}>{request.incoming ? 'Decline' : 'Cancel request'}</button></div>
        </li>)}</ul></div> : null}
      </section>
      <section className="panel" aria-labelledby="groups-heading">
        <div className="panel-heading"><h3 id="groups-heading">Sharing groups</h3><span className="count-badge">{query.data?.groups.length ?? 0}</span></div>
        <form className="stack-form" onSubmit={event => {
          event.preventDefault(); setNotice('');
          action.mutate({ path: '/api/groups', method: 'POST', body: { name: name.trim(), memberIds: selected } }, { onSuccess: () => { setName(''); setSelected([]); } });
        }}>
          <label htmlFor="group-name">Group name</label><input id="group-name" placeholder="Project team, family…" required maxLength={60} value={name} onChange={event => setName(event.target.value)} />
          <fieldset className="group-members"><legend>Choose friends (up to 5, plus you)</legend>
            {friends.map(friend => <label key={friend.id}><input type="checkbox" checked={selected.includes(friend.peer.id)} disabled={!selected.includes(friend.peer.id) && selected.length >= 5}
              onChange={event => setSelected(previous => event.target.checked ? [...previous, friend.peer.id] : previous.filter(id => id !== friend.peer.id))} />{friend.peer.name}</label>)}
            {!friends.length ? <p className="micro-copy">Add and accept a friend to create a group.</p> : null}
          </fieldset>
          <button className="button button-secondary" disabled={action.isPending || !selected.length}>Create group</button>
        </form>
        <ul className="people-list group-list">{query.data?.groups.map(group => <li key={group.id}>
          <div><strong>{group.name}</strong><span className="micro-copy">{group.members.map(member => member.name).join(', ')}</span></div>
          <div className="button-row"><button className="button button-small" disabled={activeGroup === group.id} onClick={() => onJoin(group.id)}>{activeGroup === group.id ? 'Joined' : 'Join ' + group.name}</button>
            <button className="text-button" disabled={action.isPending} onClick={() => {
              if (!window.confirm(group.ownerId === userId ? 'Delete this group for all members?' : 'Leave this saved group?')) return;
              action.mutate({ path: '/api/groups/' + group.id + (group.ownerId === userId ? '' : '/leave'), method: group.ownerId === userId ? 'DELETE' : 'POST' });
            }}>{group.ownerId === userId ? 'Delete group' : 'Leave group'}</button></div>
        </li>)}</ul>
        <p className="micro-copy">Join the same group on each device. Files go directly to the connected members you select.</p>
      </section>
    </div>
    {action.error ? <p role="alert" className="error-message">{action.error.message}</p> : null}
    {notice ? <p className="micro-copy" role="status">{notice}</p> : null}
  </section>;
}