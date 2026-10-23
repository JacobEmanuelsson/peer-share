import AccountActions from './features/auth/components/AccountActions';
import AccountSettings from './features/auth/components/AccountSettings';
import { Route, Routes } from 'react-router';
import App from './App';
import HomePage from './pages/HomePage';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import NotFoundPage from './pages/NotFoundPage';
import SessionBoundary from './features/auth/components/SessionBoundary';

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<App />}>
        <Route index element={<LandingPage />} />
        <Route element={<SessionBoundary authenticated />}>
          <Route path="app" element={<HomePage />} />
          <Route path="settings" element={<AccountSettings />} />
        </Route>
        <Route element={<SessionBoundary authenticated={false} />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="sign-up" element={<SignupPage />} />
        </Route>
        <Route path="forgot-password" element={<AccountActions mode="forgot" />} />
        <Route path="reset-password" element={<AccountActions mode="reset" />} />
        <Route path="verify-email" element={<AccountActions mode="verify" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}