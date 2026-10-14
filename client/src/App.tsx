import { NavLink, Outlet } from 'react-router';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <header className="mb-10 border-b border-slate-700 pb-6">
          <p className="mb-4 text-xl font-bold">Peer Share</p>
          <nav aria-label="Main navigation" className="flex gap-6">
            <NavLink to="/" end className="underline aria-[current=page]:text-teal-300">Home</NavLink>
            <NavLink to="/login" className="underline aria-[current=page]:text-teal-300">Sign in</NavLink>
            <NavLink to="/sign-up" className="underline aria-[current=page]:text-teal-300">Sign up</NavLink>
          </nav>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
