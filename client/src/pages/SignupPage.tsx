import { Link } from 'react-router';
import SignupForm from '../features/auth/components/SignupForm';

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold">Create an account</h1>
      <SignupForm />
      <p className="mt-6">
        Already have an account? <Link to="/login" className="text-teal-300 underline">Sign in</Link>
      </p>
    </>
  );
}
