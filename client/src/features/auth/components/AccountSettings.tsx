import { clearAccountHistory } from '../../chat/chatStore';
import { useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { authClient } from '../api/authClient';
export default function AccountSettings() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const { data: session } = authClient.useSession();
  const navigate = useNavigate(), queryClient = useQueryClient();
  async function submit(event: SubmitEvent<HTMLFormElement>, deleting = false) {
    event.preventDefault(); if (busy) return;
    const userId = session?.user.id;
    const form = event.currentTarget, data = new FormData(form);
    if (deleting && data.get('confirm') !== 'DELETE') { setError('Type DELETE to confirm.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const password = String(data.get('currentPassword'));
      const result = deleting ? await authClient.deleteUser({ password }) : await authClient.changePassword({ currentPassword: password, newPassword: String(data.get('newPassword')), revokeOtherSessions: true });
      if (result.error) { setError(result.error.message ?? 'Could not update your account.'); return; }
      form.reset();
      if (deleting) { let localFailed = false; if (userId) await clearAccountHistory(userId).catch(() => { localFailed = true; }); queryClient.clear(); await authClient.signOut(); navigate('/login?deleted=1' + (localFailed ? '&local=1' : ''), { replace: true }); }
      else setNotice('Password updated. Other sessions have been revoked.');
    } catch { setError('Could not reach the server. Please try again.'); }
    finally { setBusy(false); }
  }
  return <div className="workspace"><h1>Account settings</h1>
    <section className="panel"><h2>Change password</h2><form className="auth-form" onSubmit={event => void submit(event)}>
      <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required disabled={busy} /></label>
      <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} /></label>
      <button className="button" disabled={busy}>Update password</button>
    </form></section>
    <section className="panel"><h2>Delete account</h2><p>This permanently removes your account, sessions, friendships and owned groups. You will leave other groups. History on other devices is not remotely erased.</p>
      <form className="auth-form" onSubmit={event => void submit(event, true)}>
        <label>Password to delete account<input name="currentPassword" type="password" autoComplete="current-password" required disabled={busy} /></label>
        <label>Type DELETE to confirm<input name="confirm" required disabled={busy} autoComplete="off" /></label>
        <button className="button button-secondary" disabled={busy}>Delete my account</button>
      </form></section>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
  </div>;
}