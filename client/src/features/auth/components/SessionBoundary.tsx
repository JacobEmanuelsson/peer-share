import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router';
import { authClient } from '../api/authClient';

// Guards control navigation. The backend independently verifies every protected request.
export default function SessionBoundary({ authenticated }: { authenticated: boolean }) {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  useEffect(() => {
    const refresh = () => { void refetch({ query: { disableCookieCache: true } }); };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [refetch]);

  if (isPending) return <div className="session-state" role="status"><span className="status-dot" />Checking your session…</div>;
  if (error) return (
    <div className="session-state">
      <p role="alert">We couldn’t verify your session. Please try again.</p>
      <button className="button button-secondary" onClick={() => void refetch({ query: { disableCookieCache: true } })}>Try again</button>
    </div>
  );
  if (session && session.user.emailVerified !== true) return <Navigate to="/verify-email" replace />;
  if (authenticated && !session) return <Navigate to="/login" replace />;
  if (!authenticated && session) return <Navigate to="/app" replace />;
  return <Outlet />;
}