"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import Link from "next/link";
import styles from "./account-settings.module.css";

type Submission =
  | { state: "idle" }
  | { state: "busy"; kind: "email" | "password" }
  | { state: "success" | "error"; message: string };

export function AccountSettings({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submission, setSubmission] = useState<Submission>({ state: "idle" });
  const busy = submission.state === "busy";

  async function submit(event: FormEvent, kind: "email" | "password") {
    event.preventDefault();
    if (busy || !ACCOUNTS_ENABLED) return;
    if (kind === "password" && password !== confirmation) {
      setSubmission({ state: "error", message: "The passwords do not match." });
      return;
    }
    setSubmission({ state: "busy", kind });
    try {
      const client = await createClient();
      const { data, error: userError } = await client.auth.getUser();
      if (userError || !data.user || data.user.id !== userId) {
        setSubmission({
          state: "error",
          message:
            "Your session has expired or changed. Sign in again before changing your account.",
        });
        return;
      }
      if (kind === "password") {
        const { data: signedIn, error } = await client.auth.signInWithPassword({
          email: data.user.email || email,
          password: currentPassword,
        });
        if (error || signedIn.user?.id !== userId)
          throw new Error("Current password could not be verified.");
      }
      const { error } =
        kind === "email"
          ? await client.auth.updateUser(
              { email: newEmail.trim() },
              {
                emailRedirectTo: `${window.location.origin}/auth/callback?next=/account`,
              },
            )
          : await client.auth.updateUser({
              password,
              current_password: currentPassword,
            });
      if (error) throw error;
      setCurrentPassword("");
      setPassword("");
      setConfirmation("");
      if (kind === "email") setNewEmail("");
      setSubmission({
        state: "success",
        message:
          kind === "email"
            ? "Check your inboxes for confirmation instructions. Your sign-in email stays the same until the change is confirmed."
            : "Your password has been updated.",
      });
    } catch {
      setSubmission({
        state: "error",
        message:
          kind === "email"
            ? "We couldn’t request that email change. Try again or use another address."
            : "We couldn’t update your password. Check your current password and try again. If a security code is required, request a password reset.",
      });
    }
  }

  return (
    <div className={`auth-card ${styles.settings}`}>
      <span className="eyebrow">YOUR ACCOUNT</span>
      <h1>Account settings</h1>
      <p>Signed in as {email || "your verified account"}.</p>
      <form
        onSubmit={(event) => submit(event, "email")}
        aria-label="Change email"
      >
        <h2>Change email</h2>
        <label>
          New email address
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={254}
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
          />
        </label>
        <button
          className="button button-primary"
          disabled={busy || !ACCOUNTS_ENABLED}
        >
          Request email change
        </button>
      </form>
      <form
        onSubmit={(event) => submit(event, "password")}
        aria-label="Change password"
      >
        <h2>Change password</h2>
        <label>
          Current password
          <input
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
            maxLength={128}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        <label>
          New password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
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
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        <button
          className="button button-primary"
          disabled={busy || !ACCOUNTS_ENABLED}
        >
          Update password
        </button>
      </form>
      {submission.state === "error" && (
        <p className="form-error" role="alert">
          {submission.message}
        </p>
      )}
      {submission.state === "success" && (
        <p className="inline-notice" role="status">
          {submission.message}
        </p>
      )}
      <p className="auth-switch">
        <Link href="/forgot-password">Forgot your current password?</Link>
      </p>
    </div>
  );
}
