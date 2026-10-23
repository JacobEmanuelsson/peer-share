import { Link } from 'react-router';
import SignupForm from '../features/auth/components/SignupForm';
import AuthLayout from '../features/auth/components/AuthLayout';

export default function SignupPage() {
  return <AuthLayout title="Make a connection." description="Create your account and start sharing directly.">
    <SignupForm />
    <p className="auth-switch">Already have an account? <Link to="/login">Sign in <span aria-hidden="true">↗</span></Link></p>
  </AuthLayout>;
}