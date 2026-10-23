import { useState } from 'react';

export default function ConnectionExplainer() {
  const [mode, setMode] = useState<'setup' | 'transfer'>('setup');
  return <section id="how-it-works" className="landing-explainer" aria-labelledby="explanation-title">
    <div className="explainer-copy"><p className="eyebrow">A LITTLE UNDER THE HOOD</p><h2 id="explanation-title">Introduced by a server.<br /><span>Connected to each other.</span></h2><p>The server helps the right people meet. Your file contents travel over their encrypted WebRTC connection.</p>
      <div className="explainer-switch" role="group" aria-label="Explore the connection flow"><button type="button" aria-pressed={mode === 'setup'} onClick={() => setMode('setup')}>01 · Connection setup</button><button type="button" aria-pressed={mode === 'transfer'} onClick={() => setMode('transfer')}>02 · File transfer</button></div>
    </div>
    <div className={'explainer-diagram mode-' + mode}>
      <div className="diagram-server"><span aria-hidden="true">▤</span><strong>Signaling server</strong><small>{mode === 'setup' ? 'Invitations + connection details' : 'No file contents stored here'}</small></div>
      <div className="diagram-paths" aria-hidden="true"><span /><span /></div>
      <div className="diagram-peers"><span>You</span><div className="diagram-direct-line" aria-hidden="true">↔</div><span>Your person</span></div>
      <p className="diagram-description" role="status">{mode === 'setup' ? 'Authenticated browsers exchange setup details through the server.' : 'File data uses an encrypted DataChannel. Each recipient accepts before receiving.'}</p>
      <p className="micro-copy">Some networks need a TURN relay for encrypted traffic. Cross-network deployment still needs that configuration.</p>
    </div>
  </section>;
}