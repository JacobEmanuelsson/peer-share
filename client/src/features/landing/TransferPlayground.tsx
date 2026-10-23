import { useEffect, useRef, useState } from 'react';

const people = [
  { id: 'mia', name: 'Mia', initials: 'MI', color: 'peach' },
  { id: 'noah', name: 'Noah', initials: 'NO', color: 'lavender' },
  { id: 'ava', name: 'Ava', initials: 'AV', color: 'mint' },
];
type Phase = 'choose' | 'invited' | 'connected' | 'sending' | 'complete';
const stages = ['Connect', 'Accept', 'Send'];

export default function TransferPlayground() {
  const [count, setCount] = useState(1);
  const [selected, setSelected] = useState(['mia']);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('choose');
  const [progress, setProgress] = useState(0);
  const start = useRef(0);
  const visible = people.slice(0, count);
  const recipients = visible.filter(person => selected.includes(person.id));
  const ready = recipients.filter(person => accepted.includes(person.id));
  const step = phase === 'choose' ? 0 : phase === 'invited' ? 1 : 2;

  useEffect(() => {
    if (phase !== 'sending') return;
    start.current = performance.now();
    const timer = setInterval(() => {
      const next = Math.min(100, Math.round((performance.now() - start.current) / 24));
      setProgress(next);
      if (next === 100) setPhase('complete');
    }, 80);
    return () => clearInterval(timer);
  }, [phase]);

  function reset() { setPhase('choose'); setProgress(0); setAccepted([]); }
  function accept(id: string) {
    const next = [...accepted, id];
    setAccepted(next);
    if (recipients.every(person => next.includes(person.id))) setPhase('connected');
  }
  const status = phase === 'choose' ? 'Pick your people, then connect.'
    : phase === 'invited' ? 'Now play the recipient. Accept each invitation.'
    : phase === 'connected' ? 'Connection accepted. Your sample file is ready.'
    : phase === 'sending' ? 'Sample file in flight. Each person gets a separate copy.'
    : 'That’s the idea. Your file, delivered directly.';

  return (
    <section className="playground" aria-labelledby="playground-title">
      <div className="playground-header"><div><span className="live-dot" /><span id="playground-title">THE SHARING PLAYGROUND</span></div><span className="simulation-badge">SIMULATION</span></div>
      <ol className="demo-steps" aria-label="Demo steps">{stages.map((label, index) => <li key={label} className={index === step ? 'current' : index < step ? 'done' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? '✓' : '0' + (index + 1)}</span>{label}</li>)}</ol>
      <div className={'demo-scene phase-' + phase}>
        <svg className="demo-wires" viewBox="0 0 600 360" preserveAspectRatio="none" aria-hidden="true">
          {visible.map((person, index) => {
            const y = count === 1 ? 180 : count === 2 ? 115 + index * 130 : 80 + index * 100;
            return <g key={person.id} className={selected.includes(person.id) ? 'wire-selected' : 'wire-muted'}>
              <path className="wire-base" d={`M 180 180 C 290 180 290 ${y} 420 ${y}`} />
              {selected.includes(person.id) && (phase === 'sending' || phase === 'complete') ? <path className="wire-flow" d={`M 180 180 C 290 180 290 ${y} 420 ${y}`} /> : null}
            </g>;
          })}
        </svg>
        <div className="demo-device demo-sender">
          <span className="demo-avatar sender-avatar" aria-hidden="true">YOU</span>
          <strong>Your device</strong><span className="demo-device-caption">Where it starts</span>
          <div className="sample-file"><span className="sample-file-icon" aria-hidden="true">↗</span><span>hello-world.zip<small>2.4 MB · Sample file</small></span></div>
        </div>
        <div className="demo-recipients" aria-label="Demo recipients">
          {visible.map(person => {
            const chosen = selected.includes(person.id), hasAccepted = accepted.includes(person.id);
            return <div key={person.id} className={'demo-device demo-recipient ' + (chosen ? 'recipient-selected' : '')}>
              <div className="recipient-identity"><span className={'demo-avatar avatar-' + person.color} aria-hidden="true">{person.initials}</span><div><strong>{person.name}</strong><span className="demo-device-caption">{!chosen ? 'Not selected' : phase === 'choose' ? 'Ready to invite' : !hasAccepted ? 'Invitation waiting' : phase === 'complete' ? 'Sample received ✓' : phase === 'sending' ? 'Receiving sample…' : 'Connection accepted'}</span></div>
                <label className="demo-select"><span className="sr-only">Select {person.name}</span><input type="checkbox" checked={chosen} disabled={phase !== 'choose'} onChange={event => setSelected(previous => event.target.checked ? [...previous, person.id] : previous.filter(id => id !== person.id))} /></label></div>
              {chosen && phase === 'invited' && !hasAccepted ? <button type="button" className="demo-accept" onClick={() => accept(person.id)}>Accept as {person.name} <span aria-hidden="true">↙</span></button> : null}
              {chosen && hasAccepted && (phase === 'sending' || phase === 'complete') ? <progress aria-label={'Simulated transfer to ' + person.name} max={100} value={progress} /> : null}
            </div>;
          })}
          <button type="button" className="demo-add" disabled={count === people.length || phase !== 'choose'} onClick={() => {
            const next = people[count]; setCount(previous => previous + 1); setSelected(previous => [...previous, next.id]);
          }}><span aria-hidden="true">+</span> {count === people.length ? 'All demo people added' : 'Add a person'}</button>
        </div>
        <div className="demo-link-label" aria-hidden="true">{phase === 'sending' ? 'FILE IN FLIGHT' : phase === 'complete' ? 'DIRECT DELIVERY' : 'A DIRECT CONNECTION'}</div>
      </div>
      <div className="demo-controls">
        <div><p role="status" className="demo-status">{status}</p><span className="demo-caption">{selected.length} {selected.length === 1 ? 'recipient' : 'recipients'} selected · No real files or connections</span></div>
        {phase === 'choose' ? <button className="button" type="button" disabled={!selected.length} onClick={() => setPhase('invited')}>Connect <span aria-hidden="true">↗</span></button> :
          phase === 'invited' ? <span className="demo-waiting">{ready.length}/{recipients.length} accepted</span> :
          phase === 'connected' ? <button className="button" type="button" onClick={() => { setProgress(0); setPhase('sending'); }}>Send sample file <span aria-hidden="true">↗</span></button> :
          phase === 'sending' ? <span className="demo-percent" aria-live="off">{progress}%</span> :
          <button className="button button-secondary" type="button" onClick={reset}>Try again <span aria-hidden="true">↻</span></button>}
      </div>
      <div className="demo-bottom"><span>This is a guided preview. Real recipients accept on their own devices.</span>{phase !== 'choose' && phase !== 'complete' ? <button type="button" className="text-button" onClick={reset}>Reset demo</button> : null}</div>
    </section>
  );
}