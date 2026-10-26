import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authClient } from '../api/authClient';
import AuthLayout from './AuthLayout';

export default function AccountActions({ mode }: { mode: 'forgot' | 'reset' | 'verify' }) {
  const [params] = useSearchParams(), navigate = useNavigate();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const { data: session } = authClient.useSession();
  const verify = mode === 'verify';
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget); setBusy(true); setError(''); setNotice('');
    try {
      const result = mode === 'forgot'
        ? await authClient.requestPasswordReset({ email: String(data.get('email')), redirectTo: '/reset-password' })
        : mode === 'reset'
          ? await authClient.resetPassword({ newPassword: String(data.get('password')), token: params.get('token') ?? '' })
          : await authClient.sendVerificationEmail({ email: String(data.get('email')), callbackURL: '/login?verified=1' });
      if (result.error) { setError(result.error.message ?? 'Could not complete your request.'); return; }
      if (mode === 'reset') { navigate('/login?reset=1', { replace: true }); return; }
      setNotice(verify ? 'If verification is needed, an email has been sent. Open the newest link, then sign in.' : 'If that account exists, a password-reset email has been sent.');
    } catch { setError('Could not reach the server. Try again.'); }
    finally { setBusy(false); }
  }
  return <AuthLayout title={mode === 'forgot' ? 'Forgot your password?' : mode === 'reset' ? 'Choose a new password.' : 'Check your email.'}
    description={verify ? 'Verify your address, then sign in to start sharing.' : 'Use the link in your email to continue.'}>
    {params.has('error') ? <p role="alert">This link is invalid or expired. Request a new one.</p> : null}
    {verify ? <section className="verification-guide" aria-labelledby="verification-steps">
      <h3 id="verification-steps">Finish setting up your account</h3>
      <ol>
        <li>Open the Peer Share verification email. Check spam or junk if it is missing.</li>
        <li>Open the newest verification link. It takes you to the sign-in page.</li>
        <li>Sign in with the email and password you registered.</li>
      </ol>
      <p>Opened the email on your phone? You can return to your computer and sign in there. This tab will not update automatically.</p>
      <Link className="button" to="/login">I have verified my email — sign in</Link>
    </section> : null}
    <form className="auth-form" onSubmit={submit} aria-busy={busy}>
      {verify ? <h3 className="auth-section-title">Need another verification email?</h3> : null}
      {mode === 'reset' ? <label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy || !params.get('token')} /></label>
        : <label>Email<input name="email" type="email" autoComplete="email" defaultValue={session?.user.email ?? params.get('email') ?? ''} required disabled={busy} /></label>}
      {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
      <button className="button" disabled={busy || (mode === 'reset' && !params.get('token'))}>{busy ? 'Working…' : mode === 'reset' ? 'Reset password' : verify ? 'Resend verification email' : 'Send reset email'}</button>
    </form>
    {verify && session ? <button className="text-button" onClick={() => void authClient.signOut().then(() => navigate('/login'))}>Sign out</button> : null}
    {mode === 'reset' ? <p><Link to="/forgot-password">Request a new reset link</Link></p> : null}
    {!verify ? <p><Link to="/login">Back to sign in</Link></p> : null}
  </AuthLayout>;
}