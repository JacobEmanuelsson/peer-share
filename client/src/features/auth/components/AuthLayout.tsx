import type { ReactNode } from 'react';

export default function AuthLayout({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">LESS DISTANCE. MORE CONNECTION.</p>
        <h1>Your files.<br />Their destination.<br /><span>No detours.</span></h1>
        <p>A direct connection for the things you want to share. Pick your person, accept the connection, and send.</p>
        <div className="connection-art" aria-hidden="true"><span className="device-node">YOU<span>↗</span></span><span className="connection-line" /><span className="device-node">THEM<span>↙</span></span></div>
        <div className="auth-points"><span>01 / Invite your person</span><span>02 / Connect directly</span><span>03 / Share with confidence</span></div>
      </section>
      <section className="auth-card"><p className="eyebrow">WELCOME TO PEER SHARE</p><h2>{title}</h2><p className="muted">{description}</p>{children}</section>
    </div>
  );
}