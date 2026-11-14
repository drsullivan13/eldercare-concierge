import { useState } from "react";
import { Modal } from "../modal";

export function DemoImportDialog({
  importDemo,
  error,
  close,
  blocked,
}: {
  importDemo: () => Promise<boolean>;
  error: string;
  close: () => void;
  blocked: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  return (
    <Modal title="Import your demo plan" close={close}>
      <h2>Copy this browser&apos;s demo plan?</h2>
      <p className="muted">
        This copies your profile, saved providers, notes, tasks and private
        rehearsal history into this account. It only works while your account
        workspace is empty. Your demo stays in this browser.
      </p>
      <form
        className="dialog-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!confirmed || pending || blocked) return;
          setFailure("");
          setPending(true);
          try {
            if (await importDemo()) close();
          } catch {
            setFailure(
              "Your demo plan could not be imported. Please try again.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <label className="checkbox-label">
          <input
            type="checkbox"
            required
            checked={confirmed}
            disabled={pending || blocked}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I want to copy my private local plan and rehearsal history to this
          account.
        </label>
        {(error || failure) && (
          <p className="form-error" role="alert">
            {error || failure}
          </p>
        )}
        {blocked && (
          <p className="form-error" role="alert">
            Import is not available for this workspace. Close this dialog and
            reload the latest workspace if it changed elsewhere.
          </p>
        )}
        <button
          className="button button-primary full-width"
          disabled={!confirmed || pending || blocked}
        >
          {pending ? "Importing…" : "Import demo plan"}
        </button>
        <button type="button" className="text-link" onClick={close}>
          {pending ? "Close" : "Keep using my account without importing"}
        </button>
      </form>
    </Modal>
  );
}
