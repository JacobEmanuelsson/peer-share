import { Link } from 'react-router';
import LoginForm from '../features/auth/components/LoginForm';
import AuthLayout from '../features/auth/components/AuthLayout';

export default function LoginPage() {
  return <AuthLayout title="Welcome back." description="Sign in to your sharing workspace.">
    <LoginForm />
    <p className="auth-switch">New around here? <Link to="/sign-up">Create an account <span aria-hidden="true">↗</span></Link></p>
  </AuthLayout>;
}