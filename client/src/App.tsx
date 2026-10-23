import { Link, NavLink, Outlet } from 'react-router';
import { authClient } from './features/auth/api/authClient';
import LogoutButton from './features/auth/components/LogoutButton';

export default function App() {
  const { data: session, isPending, error } = authClient.useSession();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <Link to="/" className="brand" aria-label="Peer Share home"><span className="brand-mark" aria-hidden="true">↗</span>peer<span className="brand-light">share</span><span className="beta">BETA</span></Link>
        <nav aria-label="Main navigation" className="main-nav">
          {!isPending && !error ? session ? (
            <><NavLink to="/app">Open workspace</NavLink><NavLink to="/settings">Account</NavLink><span className="user-label">{session.user.name}</span><LogoutButton /></>
          ) : <><NavLink to="/login">Sign in</NavLink><Link className="button button-small" to="/sign-up">Create account <span aria-hidden="true">↗</span></Link></> : null}
        </nav>
      </header>
      <main id="main-content"><Outlet /></main>
      <footer className="site-footer"><span>Files move between you.</span><span>WebRTC encrypted transport <span className="footer-dot">·</span> Made for direct connections</span></footer>
    </div>
  );
}