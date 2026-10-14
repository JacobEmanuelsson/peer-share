import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <>
      <h1 className="mb-4 text-3xl font-bold">Page not found</h1>
      <Link to="/" className="text-teal-300 underline">Return home</Link>
    </>
  );
}
