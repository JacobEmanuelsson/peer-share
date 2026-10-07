import SignupForm from "./features/auth/SignupForm";
import LoginForm from "./features/auth/LoginForm";

export default function App() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-20 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <SignupForm/>
        <LoginForm/>
      </div>
    </main>
  );
}
