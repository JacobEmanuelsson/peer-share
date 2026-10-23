import { Link } from 'react-router';
export default function NotFoundPage() {
  return <div className="empty-page"><p className="eyebrow">404 / A WRONG TURN</p><h1>Nothing to share here.</h1><p>This page doesn’t exist. Let’s get you back.</p><Link to="/" className="button">Return home ↗</Link></div>;
}