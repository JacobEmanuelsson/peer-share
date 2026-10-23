import { Link } from 'react-router';
import { authClient } from '../features/auth/api/authClient';
import TransferPlayground from '../features/landing/TransferPlayground';
import ConnectionExplainer from '../features/landing/ConnectionExplainer';
import '../features/landing/landing.css';

export default function LandingPage() {
  const { data: session, isPending, error } = authClient.useSession();
  const signedIn = Boolean(session && !error);
  const destination = signedIn ? '/app' : '/sign-up';
  return <div className="landing-page">
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="landing-hero-copy"><p className="eyebrow"><span className="status-dot" /> LESS UPLOAD. MORE CONNECTION.</p>
        <h1 id="landing-title">Your files.<br />Your people.<br /><span>A direct line.</span></h1>
        <p className="landing-lede">From your screen to theirs. Share files, bring your group together, and keep the conversation going.</p>
        <div className="landing-actions"><Link className="button" to={destination}>{signedIn ? 'Open workspace' : 'Start sharing'} <span aria-hidden="true">↗</span></Link><a className="landing-secondary-link" href="#try-it">Try the demo <span aria-hidden="true">↓</span></a></div>
        <p className="landing-fine-print">{isPending ? 'Checking your session…' : 'Free to explore. No account needed for the demo.'}</p>
        <div className="hero-facts"><span><strong>01 → many</strong>Share with your group</span><span><strong>1 GiB</strong>Per file, for now</span></div>
      </div>
      <div id="try-it" className="landing-demo-wrap"><div className="demo-orbit-label"><span aria-hidden="true">✳</span> A SMALL DEMO. A REAL POSSIBILITY.</div><TransferPlayground /></div>
    </section>
    <div className="landing-principles" aria-label="Sharing features"><span><i aria-hidden="true">↗</i> Direct browser connections</span><span><i aria-hidden="true">◎</i> Every recipient chooses</span><span><i aria-hidden="true">≋</i> Friends, groups & conversations</span></div>
    <section className="landing-features" aria-labelledby="features-title">
      <div className="landing-section-heading"><p className="eyebrow">BUILT AROUND THE PEOPLE</p><h2 id="features-title">One friend. The whole team.<br /><span>The same simple idea.</span></h2></div>
      <div className="feature-grid">
        <article><span className="feature-number">01 / CONNECT</span><div className="feature-glyph" aria-hidden="true">↗</div><h3>Skip the copy-and-paste dance.</h3><p>Add friends once. Invite them from your workspace whenever you have something to share.</p></article>
        <article><span className="feature-number">02 / BRING YOUR PEOPLE</span><div className="feature-glyph" aria-hidden="true">⊕</div><h3>A little more room for everyone.</h3><p>Create groups of up to six. Select connected members and send, with a separate choice for every recipient.</p></article>
        <article><span className="feature-number">03 / KEEP THE CONTEXT</span><div className="feature-glyph" aria-hidden="true">≋</div><h3>More than “here’s that file.”</h3><p>Chat alongside your transfers. See who sent what and when, with history saved in this browser.</p></article>
      </div>
    </section>
    <ConnectionExplainer />
    <section className="landing-invite" aria-labelledby="landing-invite-title"><div><p className="eyebrow">SOMETHING WORTH SHARING?</p><h2 id="landing-invite-title">Make the connection.</h2><p>Your people are the destination.</p></div><Link className="button" to={destination}>{signedIn ? 'Open your workspace' : 'Create your account'} <span aria-hidden="true">↗</span></Link></section>
  </div>;
}