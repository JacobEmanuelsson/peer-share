import { useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router';
import { authClient } from '../api/authClient';

export default function SignupForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError('');
    const data = new FormData(event.currentTarget);
    const name = data.get('name'), email = data.get('email'), password = data.get('password');
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') return;
    if (!name.trim()) { setError('Enter your name.'); return; }
    setLoading(true);
    try {
      const result = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password, callbackURL: "/login?verified=1" });
      if (result.error) { setError(result.error.message ?? 'Could not create your account.'); return; }
      navigate('/verify-email?email=' + encodeURIComponent(email.trim()), { replace: true });
    } catch { setError('Could not reach the server. Please try again.'); }
    finally { setLoading(false); }
  }
  return (
    <form className="auth-form" onSubmit={handleSubmit} aria-busy={loading}>
      <label htmlFor="name">Name<input type="text" name="name" id="name" autoComplete="name" placeholder="Your name" required maxLength={100} disabled={loading} /></label>
      <label htmlFor="email">Email<input type="email" name="email" id="email" autoComplete="email" placeholder="you@example.com" required disabled={loading} /></label>
      <label htmlFor="password">Password<input type="password" name="password" id="password" autoComplete="new-password" placeholder="At least 8 characters" minLength={8} maxLength={128} required disabled={loading} aria-describedby="password-hint" /></label>
      <p id="password-hint" className="form-note">Use 8–128 characters. Your password is also validated by the server.</p>
      {error ? <p role="alert" className="error-message">{error}</p> : null}
      <button className="button" type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'} <span aria-hidden="true">↗</span></button>
    </form>
  );
}