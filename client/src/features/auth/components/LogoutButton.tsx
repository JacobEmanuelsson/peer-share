import { authClient } from '../api/authClient';
import { useState } from 'react';
import { useNavigate } from 'react-router';

export default function LogoutButton() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  async function handleClick() {
    if (loading) return;
    setLoading(true); setError('');
    try {
      const result = await authClient.signOut();
      if (result.error) { setError(result.error.message ?? 'Could not sign out.'); return; }
      navigate('/login', { replace: true });
    } catch { setError('Could not sign out. Please try again.'); }
    finally { setLoading(false); }
  }
  return <div className="logout-control">
    <button className="button button-secondary button-small" type="button" onClick={handleClick} disabled={loading}>{loading ? 'Signing out…' : 'Sign out'}</button>
    {error ? <p role="alert" className="error-message">{error}</p> : null}
  </div>;
}