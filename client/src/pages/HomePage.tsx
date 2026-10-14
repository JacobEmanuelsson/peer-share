import ConnectionDemo from '../features/signaling/components/ConnectionDemo';
import { Link } from 'react-router';
import { authClient } from '../features/auth/api/authClient';
import LogoutButton from '../features/auth/components/LogoutButton';

export default function HomePage() {
  const { data: session, isPending, error } = authClient.useSession();

  if (isPending) return <p>Checking session…</p>;
  if (error) return <p role="alert">Could not check your session.</p>;

  return (
    <>
      <h1 className="mb-4 text-3xl font-bold">Peer Share</h1>
      <p className="mb-6 text-slate-300">Your file-sharing workspace will be built here.</p>
      {session ? (
        <>
          <p className="mb-4">Welcome, {session.user.name}.</p>
          <LogoutButton />
        </>
      ) : (
        <Link to="/login" className="text-teal-300 underline">Sign in</Link>
      )}
      <ConnectionDemo />
    </>
  );
}
