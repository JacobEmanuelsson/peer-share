import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authClient } from '../api/authClient';

export default function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError('');
    const data = new FormData(event.currentTarget);
    const email = data.get('email'), password = data.get('password');
    if (typeof email !== 'string' || typeof password !== 'string') return;
    setLoading(true);
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) { setError(result.error.message ?? 'Could not sign in.'); return; }
      navigate('/app', { replace: true });
    } catch { setError('Could not reach the server. Please try again.'); }
    finally { setLoading(false); }
  }
  return (
    <form className="auth-form" onSubmit={handleSubmit} aria-busy={loading}>
      {params.has('error') ? <p role="alert">This verification link is invalid or expired. Use “Resend verification email” below to request a new link.</p> : null}
      {params.get('verified') === '1' && !params.has('error') ? <div className="verification-success" role="status">
        <strong>Email verified. You can sign in.</strong>
        <p>Use your registered email and password below. If you opened this link on your phone, you can also sign in on your computer.</p>
      </div> : null}
      {params.has('reset') ? <p role="status">Password reset. Sign in with your new password.</p> : null}
      {params.has('deleted') ? <p role="status">Your account has been deleted.</p> : null}
      {params.has('local') ? <p role="alert">Local history could not be cleared. Clear this site's data in your browser settings.</p> : null}
      <label htmlFor="email">Email<input type="email" name="email" id="email" autoComplete="email" placeholder="you@example.com" required disabled={loading} /></label>
      <label htmlFor="password">Password<input type="password" name="password" id="password" autoComplete="current-password" placeholder="Your password" required disabled={loading} /></label>
      {error ? <p role="alert" className="error-message">{error}</p> : null}
      <button className="button" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'} <span aria-hidden="true">↗</span></button>
      <p><Link to="/forgot-password">Forgot password?</Link> · <Link to="/verify-email">Resend verification email</Link></p>
      <p className="form-note">Your session stays protected with a secure account login.</p>
    </form>
  );
}