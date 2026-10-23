import TransferCapabilities from '../webrtc/TransferCapabilities';
import { useState } from 'react';
import ConnectionDemo from '../features/signaling/components/ConnectionDemo';
import { authClient } from '../features/auth/api/authClient';
import SocialPanel from '../features/social/components/SocialPanel';
import GroupWorkspace from '../features/social/components/GroupWorkspace';

export default function HomePage() {
  const { data: session } = authClient.useSession();
  const [group, setGroup] = useState<string | null>(null);
  const [chatTarget, setChatTarget] = useState<{ id: string; name: string }>();
  const [quickInvite, setQuickInvite] = useState<{ userId: string; nonce: number }>();
  if (!session) return null;
  return <div className="workspace">
    <div className="page-intro"><p className="eyebrow"><span className="status-dot" /> YOUR PRIVATE WORKSPACE</p><h1>Good things are<br /><span>better shared.</span></h1><p>Connect with someone. Send a file. Keep it between you.</p></div>
    <TransferCapabilities />
    <SocialPanel userId={session.user.id} activeGroup={group} onJoin={id => { setQuickInvite(undefined); setChatTarget(undefined); setGroup(id); }} onChat={peer => { setQuickInvite(undefined); setGroup(null); setChatTarget(peer); }} onInvite={id => { setGroup(null); setChatTarget(undefined); setQuickInvite({ userId: id, nonce: Date.now() }); }} />
    {group ? <GroupWorkspace key={group} groupId={group} userId={session.user.id} userName={session.user.name} onLeave={() => setGroup(null)} /> : <ConnectionDemo key={session.user.id} userId={session.user.id} userName={session.user.name} quickInvite={quickInvite} chatTarget={chatTarget} />}
  </div>;
}