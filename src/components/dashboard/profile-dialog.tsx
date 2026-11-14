import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Modal } from "../modal";
import { CATEGORY_LABELS } from "@/lib/providers";
import type { Workspace } from "@/lib/workspace";

export function ProfileDialog({
  profile,
  save,
  close,
  error = "",
  blocked = false,
}: {
  profile: Workspace["profile"];
  save: (profile: Workspace["profile"]) => void;
  close: () => void;
  error?: string;
  blocked?: boolean;
}) {
  const [value, setValue] = useState(profile);
  return (
    <Modal title="Your care workspace" close={close}>
      <span className="eyebrow">A LITTLE CONTEXT</span>
      <h2>Make this your workspace.</h2>
      <p className="muted">
        Start with the basics. You can change these any time.
      </p>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) save(value);
        }}
      >
        <label>
          Your first name
          <input
            value={value.name}
            maxLength={80}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            placeholder="First name"
            autoComplete="given-name"
          />
        </label>
        <label>
          Who are you researching care for?
          <select
            value={value.relationship}
            onChange={(e) =>
              setValue({ ...value, relationship: e.target.value })
            }
          >
            {[
              "A parent",
              "Myself",
              "A partner",
              "Another family member",
              "Someone I support",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          ZIP code to search near
          <input
            value={value.zip}
            onChange={(e) => setValue({ ...value, zip: e.target.value })}
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            required
            placeholder="Five-digit ZIP"
          />
        </label>
        <fieldset>
          <legend>What would you like to explore?</legend>
          {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
            <label className="checkbox-label" key={id}>
              <input
                type="checkbox"
                checked={value.careTypes.includes(id)}
                onChange={() =>
                  setValue({
                    ...value,
                    careTypes: value.careTypes.includes(id)
                      ? value.careTypes.filter((c) => c !== id)
                      : [...value.careTypes, id],
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <p className="privacy-note">
          Just research preferences here. Please leave out medical, financial
          and other sensitive information.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary full-width" disabled={blocked}>
          Save & continue <ArrowRight size={16} />
        </button>
      </form>
    </Modal>
  );
}
