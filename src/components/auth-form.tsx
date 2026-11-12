"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Brand } from "./brand";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export function AuthForm({
  mode,
  initialError,
}: {
  mode: "signup" | "login";
  initialError?: string;
}) {
  const router = useRouter();
  const signup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || "");
  const [sent, setSent] = useState(false);
  const configured = isSupabaseConfigured();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const supabase = await createClient();
      if (signup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: name.trim() },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.push("/dashboard");
          router.refresh();
        } else setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        router.push("/dashboard");
        router.refresh();
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We couldn’t connect. Please try again.",
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
          <h2>{signup ? "Let’s take the first step." : "Welcome back."}</h2>
          <p>
            {signup
              ? "Create an account to keep your research and next steps in one place."
              : "Pick up where you left off."}
          </p>
          {sent ? (
            <div className="confirmation">
              <CheckCircle2 size={32} />
              <h3>Check your email</h3>
              <p>
                Use the confirmation link sent to {email} to finish creating
                your account. If it doesn’t arrive, check your spam folder.
              </p>
              <Link href="/login" className="button button-primary">
                Back to sign in
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
                <label>
                  Password
                  <span className="password-field">
                    <input
                      type={visible ? "text" : "password"}
                      name="password"
                      autoComplete={
                        signup ? "new-password" : "current-password"
                      }
                      required
                      minLength={signup ? 10 : 1}
                      maxLength={128}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        signup ? "At least 10 characters" : "Your password"
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
                  {busy ? "Connecting…" : signup ? "Create account" : "Log in"}
                  <ArrowRight size={17} />
                </button>
              </form>
              <p className="auth-switch">
                {signup ? "Already have an account?" : "New to Harbor?"}{" "}
                <Link href={signup ? "/login" : "/signup"}>
                  {signup ? "Log in" : "Create an account"}
                </Link>
              </p>
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
