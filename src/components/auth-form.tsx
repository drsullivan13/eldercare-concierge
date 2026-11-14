"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Brand } from "./brand";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { safeRelativeRedirect } from "@/lib/workspace";

const copy = {
  signup: {
    title: "Let’s take the first step.",
    description:
      "Create an account to keep your research and next steps in one place.",
    submit: "Create account",
  },
  login: {
    title: "Welcome back.",
    description: "Pick up where you left off.",
    submit: "Log in",
  },
  forgot: {
    title: "Forgot your password?",
    description: "Request a link to choose a new password.",
    submit: "Send reset link",
  },
  reset: {
    title: "Choose a new password.",
    description: "Use at least 10 characters for your new password.",
    submit: "Save new password",
  },
};

type AuthFormProps = { initialError?: string } & (
  | { mode: "reset"; userId: string; next?: never }
  | { mode: "signup" | "login" | "forgot"; next?: string; userId?: never }
);

export function AuthForm({ mode, initialError, next, userId }: AuthFormProps) {
  const router = useRouter();
  const signup = mode === "signup";
  const forgot = mode === "forgot";
  const reset = mode === "reset";
  const destination = safeRelativeRedirect(next);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || "");
  const [sent, setSent] = useState(false);
  const configured = ACCOUNTS_ENABLED && isSupabaseConfigured();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !configured) return;
    setError("");
    if ((signup || reset) && password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const supabase = await createClient();
      if (forgot) {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
          },
        );
        if (error && (!error.status || error.status >= 500)) throw error;
        setSent(true);
      } else if (reset) {
        const { data, error: userError } = await supabase.auth.getUser();
        if (userError || !data.user || data.user.id !== userId) {
          setError("Your reset session has expired. Request a new reset link.");
          return;
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        setConfirmation("");
        setSent(true);
      } else if (signup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: name.trim() },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destination)}`,
          },
        });
        if (error) {
          if (
            error.code === "user_already_exists" ||
            error.code === "email_exists"
          ) {
            setSent(true);
            return;
          }
          throw error;
        }
        if (data.session) {
          router.push(destination);
          router.refresh();
        } else setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        router.push(destination);
        router.refresh();
      }
    } catch {
      setError(
        mode === "login"
          ? "We couldn’t sign you in. Check your email and password, then try again."
          : "We couldn’t complete that request. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <aside className="auth-story">
        <Brand dark />
        <div>
          <span className="eyebrow">A LITTLE MORE CLARITY</span>
          <h1>
            Good care starts <br />
            with better <br />
            <em>questions.</em>
          </h1>
          <p>
            A place to understand your options, keep the details straight, and
            move forward together.
          </p>
          <div className="auth-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
        <span className="auth-location">CARE RESEARCH · EARLY ACCESS</span>
      </aside>
      <main className="auth-main">
        <Link href="/" className="text-link muted">
          <ArrowLeft size={16} /> Back to Harbor
        </Link>
        <div className="auth-card">
          <span className="eyebrow">YOUR CARE WORKSPACE</span>
          <h2>{copy[mode].title}</h2>
          <p>{copy[mode].description}</p>
          {sent ? (
            <div className="confirmation" role="status">
              <CheckCircle2 size={32} />
              <h3>{reset ? "Password updated" : "Check your email"}</h3>
              <p>
                {reset
                  ? "Your new password is saved. You can return to your workspace."
                  : forgot
                    ? "If an account can receive a reset email at that address, a link will arrive shortly. Open it in this browser. Check your spam folder too."
                    : "If this address needs confirmation, an email will arrive shortly. Open the link in this browser. If you already have an account, sign in instead."}
              </p>
              <Link
                href={reset ? "/dashboard" : "/login"}
                className="button button-primary"
              >
                {reset ? "Back to workspace" : "Back to sign in"}
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={submit}>
                {signup && (
                  <label>
                    Your first name
                    <input
                      name="name"
                      autoComplete="given-name"
                      required
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="First name"
                    />
                  </label>
                )}
                {!reset && (
                  <label>
                    Email address
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                )}
                {!forgot && (
                  <label>
                    {reset ? "New password" : "Password"}
                    <span className="password-field">
                      <input
                        type={visible ? "text" : "password"}
                        name="password"
                        autoComplete={
                          signup || reset ? "new-password" : "current-password"
                        }
                        required
                        minLength={signup || reset ? 10 : 1}
                        maxLength={128}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={
                          signup || reset
                            ? "At least 10 characters"
                            : "Your password"
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setVisible(!visible)}
                        aria-label={visible ? "Hide password" : "Show password"}
                      >
                        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </span>
                  </label>
                )}
                {(signup || reset) && (
                  <label>
                    Confirm new password
                    <input
                      type="password"
                      name="confirmation"
                      autoComplete="new-password"
                      required
                      minLength={10}
                      maxLength={128}
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                    />
                  </label>
                )}
                {error && (
                  <div role="alert" className="form-error">
                    {error}
                  </div>
                )}
                {!configured && (
                  <div className="inline-notice">
                    Account sign-in is being connected. You can explore the
                    working demo now; its plan stays in this browser.
                  </div>
                )}
                <button
                  className="button button-primary full-width"
                  disabled={busy || !configured}
                >
                  {busy ? "Connecting…" : copy[mode].submit}
                  <ArrowRight size={17} />
                </button>
              </form>
              {mode === "login" && (
                <p className="auth-switch">
                  <Link href="/forgot-password">Forgot your password?</Link>
                </p>
              )}
              {reset ? (
                <p className="auth-switch">
                  <Link href="/forgot-password">Request a new reset link</Link>
                </p>
              ) : forgot ? (
                <p className="auth-switch">
                  <Link href="/login">Back to sign in</Link>
                </p>
              ) : (
                <p className="auth-switch">
                  {signup ? "Already have an account?" : "New to Harbor?"}{" "}
                  <Link
                    href={`${signup ? "/login" : "/signup"}?next=${encodeURIComponent(destination)}`}
                  >
                    {signup ? "Log in" : "Create an account"}
                  </Link>
                </p>
              )}
              <div className="auth-divider">
                <span>or take a look first</span>
              </div>
              <Link
                href="/dashboard?demo=1"
                className="button button-outline full-width"
              >
                Explore the demo <ArrowRight size={17} />
              </Link>
              <p className="privacy-note">
                The demo uses real public provider records. Keep medical,
                financial and other sensitive details out of this early version.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
