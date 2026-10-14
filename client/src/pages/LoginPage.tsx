import { Link } from 'react-router';
import LoginForm from '../features/auth/components/LoginForm';

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold">Sign in</h1>
      <LoginForm />
      <p className="mt-6">
        Need an account? <Link to="/sign-up" className="text-teal-300 underline">Sign up</Link>
      </p>
    </>
  );
}
