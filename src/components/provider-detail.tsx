"use client";
import { useState } from "react";
import {
  Bookmark,
  Check,
  ExternalLink,
  FileCheck2,
  MapPin,
  Phone,
  Plus,
  ShieldAlert,
  Star,
} from "lucide-react";
import { CATEGORY_LABELS, formatPhone, type Provider } from "@/lib/providers";
import { Modal } from "./modal";
import { ProviderIcon } from "./provider-card";
import { InspectionHistory } from "./inspection-history";
function metric(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined
    ? "Not published"
    : `${value.toLocaleString()}${suffix}`;
}
export function ProviderDetail({
  provider,
  saved,
  note,
  onSave,
  onNote,
  onTask,
  close,
  saveStatus,
  saveError,
}: {
  provider: Provider;
  saved: boolean;
  note: string;
  onSave: () => void;
  onNote: (note: string) => boolean;
  onTask: (title: string) => boolean;
  close: () => void;
  saveStatus: string;
  saveError: string;
}) {
  const [draft, setDraft] = useState(note);
  const [noteSaved, setNoteSaved] = useState(false);
  const [taskAdded, setTaskAdded] = useState(false);
  return (
    <Modal title={provider.name} close={close} wide>
      <div className="detail-header">
        <div className={`provider-symbol symbol-${provider.category}`}>
          <ProviderIcon provider={provider} size={27} />
        </div>
        <span className="eyebrow">{CATEGORY_LABELS[provider.category]}</span>
        <h2>{provider.name}</h2>
        <p>
          <MapPin size={15} />
          {provider.address}, {provider.city}, {provider.state} {provider.zip}
        </p>
        <div className="detail-actions">
          <button
            className={`button ${saved ? "button-saved" : "button-primary"}`}
            onClick={onSave}
          >
            <Bookmark size={16} fill={saved ? "currentColor" : "none"} />
            {saved ? "Shortlisted" : "Save to shortlist"}
          </button>
          {provider.website && (
            <a
              className="button button-outline"
              href={provider.website}
              target="_blank"
              rel="noreferrer"
            >
              Open provider source <ExternalLink size={15} />
            </a>
          )}
          {provider.phone && (
            <a
              href={`tel:${provider.phone.replace(/[^+\d]/g, "")}`}
              className="text-link"
            >
              <Phone size={15} />
              {formatPhone(provider.phone)}
            </a>
          )}
        </div>
      </div>
      <div className="detail-body">
        <p className="detail-description">{provider.description}</p>
        {provider.serviceArea && (
          <div className="inline-notice">
            <strong>Service area reported by the provider</strong>
            <p>{provider.serviceArea}</p>
            <span>
              Office proximity does not confirm service at your address or staff
              availability.
            </span>
          </div>
        )}
        {provider.warnings.length > 0 && (
          <div className="detail-warnings">
            <ShieldAlert size={20} />
            <div>
              <strong>Read before making a decision</strong>
              {provider.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          </div>
        )}
        {provider.cms && (
          <section>
            <div className="section-title">
              <h3>Published CMS evidence</h3>
              <span>Data: {provider.cms.dataAsOf}</span>
            </div>
            <p className="small muted">
              CMS ratings apply to this certified nursing home. They do not rate
              every service or building operated by the same organization.
            </p>
            <div className="cms-ratings">
              {[
                ["Overall", provider.cms.overall],
                ["Health inspections", provider.cms.inspections],
                ["Staffing", provider.cms.staffing],
                ["Quality measures", provider.cms.quality],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <span>{label}</span>
                  <strong>
                    <Star size={18} fill="currentColor" />
                    {value ?? "—"}
                    <small>/ 5</small>
                  </strong>
                </div>
              ))}
            </div>
            <div className="metrics-grid">
              <div>
                <span>Nursing hours / resident / day</span>
                <strong>{metric(provider.cms.totalNurseHours)}</strong>
              </div>
              <div>
                <span>RN hours / resident / day</span>
                <strong>{metric(provider.cms.rnHours)}</strong>
              </div>
              <div>
                <span>Total nursing staff turnover</span>
                <strong>{metric(provider.cms.turnover, "%")}</strong>
              </div>
              <div>
                <span>Fines in CMS reporting window</span>
                <strong>
                  {metric(provider.cms.fines)}
                  {provider.cms.fineAmount !== null
                    ? ` · $${provider.cms.fineAmount.toLocaleString()}`
                    : ""}
                </strong>
              </div>
              <div>
                <span>Payment denials</span>
                <strong>{metric(provider.cms.paymentDenials)}</strong>
              </div>
              <div>
                <span>Latest inspection deficiencies</span>
                <strong>{metric(provider.cms.healthDeficiencies)}</strong>
              </div>
            </div>
            <p className="small muted">
              {provider.cms.lastInspection
                ? `Latest listed health inspection: ${provider.cms.lastInspection}. `
                : ""}
              Reporting periods vary by measure. Open the CMS source for
              definitions, inspection details and any newer data. Zero listed
              penalties is not proof that care is safe.
            </p>
          </section>
        )}
        {provider.cms && <InspectionHistory ccn={provider.cms.ccn} />}
        <section>
          <div className="section-title">
            <h3>The source trail</h3>
            <span>{provider.sources.length} documented sources</span>
          </div>
          <div className="source-list">
            {provider.sources.map((source, i) => (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="source-item"
                key={`${source.url}-${i}`}
              >
                <FileCheck2 size={20} />
                <div>
                  <strong>{source.title}</strong>
                  <p>{source.supports}</p>
                  <span>
                    {source.publisher} · Retrieved {source.checkedAt}
                    {source.dataAsOf
                      ? ` · Published data ${source.dataAsOf}`
                      : ""}
                  </span>
                </div>
                <ExternalLink size={15} />
              </a>
            ))}
          </div>
        </section>
        <section className="confirm-section">
          <h3>What to confirm next</h3>
          <ul>
            {provider.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button
            className="button button-outline"
            disabled={taskAdded}
            onClick={() => {
              setTaskAdded(
                onTask(
                  `Confirm care fit, availability and costs with ${provider.name}`,
                ),
              );
            }}
          >
            {taskAdded ? <Check size={16} /> : <Plus size={16} />}{" "}
            {taskAdded ? "Added to your plan" : "Add a follow-up to my plan"}
          </button>
        </section>
        <section className="detail-notes">
          <h3>Your questions & notes</h3>
          <p className="small muted">
            Keep this to research questions. Leave out medical records and
            sensitive personal or financial information.
          </p>
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setNoteSaved(false);
            }}
            maxLength={2000}
            rows={4}
            placeholder="What would you like to ask on a call or visit?"
            aria-label={`Notes about ${provider.name}`}
          />
          <button
            className="button button-primary"
            onClick={() => {
              setNoteSaved(onNote(draft));
            }}
          >
            {noteSaved ? <Check size={16} /> : null}
            {noteSaved ? "Note added to workspace" : "Update note"}
          </button>
          <p className="small muted" role="status">
            {saveError || saveStatus}
          </p>
        </section>
      </div>
    </Modal>
  );
}
