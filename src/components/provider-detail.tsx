"use client";
import { useEffect, useId, useRef, useState } from "react";
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
import { providerCareAlerts } from "./provider-card";
import { providerDisplayName } from "./provider-display-name";
import { InspectionHistory } from "./inspection-history";
import { HomeHealthEvidence } from "./home-health-evidence";
import { LocationResearch } from "./location-research";
import type { ProfileNavigation, ProfilePane } from "./profile-pane";
import "./provider-detail.css";

const destinations: readonly { key: ProfilePane; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "costs", label: "Costs & perks" },
  { key: "reviews", label: "Reviews" },
  { key: "details", label: "Details" },
];

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
  initialPane = "overview",
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
  initialPane?: ProfilePane;
}) {
  const [draft, setDraft] = useState(note);
  const [noteSaved, setNoteSaved] = useState(false);
  const [taskAdded, setTaskAdded] = useState(false);
  const uid = useId();
  const [navigation, setNavigation] = useState<ProfileNavigation>({
    pane: initialPane,
  });
  const tabs = useRef<Partial<Record<ProfilePane, HTMLButtonElement | null>>>(
    {},
  );
  const profileTop = useRef<HTMLDivElement>(null);
  const profile = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = profileTop.current;
    const root = profile.current;
    if (!header || !root) return;
    const observer = new ResizeObserver(() => {
      root.style.setProperty(
        "--profile-header-height",
        `${header.getBoundingClientRect().height}px`,
      );
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const navigate = (destination: ProfileNavigation) => {
    setNavigation(destination);
    if (!destination.targetId) {
      profile.current?.scrollIntoView({ block: "start" });
    }
  };
  const locality = `${provider.city}, ${provider.state} ${provider.zip}`;
  const displayLocality = `${providerDisplayName(provider.city)}, ${provider.state} ${provider.zip}`;
  const street = provider.address.trim().replace(/,+$/, "");
  const address = street.toLowerCase().endsWith(locality.toLowerCase())
    ? `${street.slice(0, -locality.length)}${displayLocality}`
    : `${street}, ${displayLocality}`;
  const alerts = providerCareAlerts(provider);
  const researchNotes = provider.warnings.filter(
    (warning) => !alerts.includes(warning),
  );
  return (
    <Modal title={provider.name} close={close} wide>
      <div className="provider-detail" ref={profile}>
        <div className="profile-top" ref={profileTop}>
          <div className="detail-header">
            <span className="eyebrow">
              {CATEGORY_LABELS[provider.category]}
            </span>
            <h2>{providerDisplayName(provider.name)}</h2>
            <p>
              <MapPin size={15} />
              {address}
            </p>
            <div className="detail-actions">
              <button
                className={`button button-outline ${saved ? "button-saved" : ""}`}
                onClick={onSave}
                aria-label={saved ? "Shortlisted" : "Save to shortlist"}
              >
                <Bookmark size={16} fill={saved ? "currentColor" : "none"} />
                {saved ? "Saved" : "Save"}
              </button>
              {provider.website && (
                <a
                  className="button button-outline"
                  href={provider.website}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Visit website"
                >
                  Website <ExternalLink size={15} />
                </a>
              )}
              {provider.phone && (
                <a
                  href={`tel:${provider.phone.replace(/[^+\d]/g, "")}`}
                  className="text-link"
                  aria-label={`Call ${formatPhone(provider.phone)}`}
                  title={formatPhone(provider.phone)}
                >
                  <Phone size={15} />
                  Call
                </a>
              )}
            </div>
          </div>
          <div
            className="place-sections"
            role="tablist"
            aria-label="Provider profile"
          >
            {destinations.map(({ key, label }, index) => (
              <button
                key={key}
                ref={(element) => {
                  tabs.current[key] = element;
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${key}`}
                aria-controls={`${uid}-panel`}
                aria-selected={navigation.pane === key}
                tabIndex={navigation.pane === key ? 0 : -1}
                onClick={() => navigate({ pane: key })}
                onKeyDown={(event) => {
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? destinations.length - 1
                        : event.key === "ArrowRight"
                          ? (index + 1) % destinations.length
                          : event.key === "ArrowLeft"
                            ? (index + destinations.length - 1) %
                              destinations.length
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  const pane = destinations[next].key;
                  navigate({ pane });
                  tabs.current[pane]?.focus({ preventScroll: true });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="detail-body">
          {provider.locationKind === "office" && (
            <div className="inline-notice">
              <strong>Office location only</strong>
              {provider.serviceArea && (
                <p>Provider-reported service area. {provider.serviceArea}</p>
              )}
              <p>
                Confirm service coverage at your address and staff availability
                directly.
              </p>
            </div>
          )}
          {alerts.length > 0 && (
            <div className="detail-warnings">
              <ShieldAlert size={20} />
              <div>
                <strong>Important care alerts</strong>
                {alerts.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            </div>
          )}
          <div
            id={`${uid}-panel`}
            role="tabpanel"
            aria-labelledby={`${uid}-tab-${navigation.pane}`}
            tabIndex={0}
          >
            <LocationResearch
              provider={provider}
              onTask={onTask}
              navigation={navigation}
              onNavigate={navigate}
              uid={uid}
            />
            <div hidden={navigation.pane !== "details"}>
              <h3 className="place-details-heading">About this provider</h3>
              <p className="detail-description">{provider.description}</p>
              {provider.locationKind !== "office" && provider.serviceArea && (
                <div className="inline-notice">
                  <strong>Service area reported by the provider</strong>
                  <p>{provider.serviceArea}</p>
                  <span>
                    Office proximity does not confirm service at your address or
                    staff availability.
                  </span>
                </div>
              )}
              {researchNotes.length > 0 && (
                <details className="detail-disclosure provider-background">
                  <summary>Provider research notes</summary>
                  <ul className="provider-research-notes">
                    {researchNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </details>
              )}
              {provider.category === "nursing-home" && provider.cms && (
                <details className="detail-disclosure">
                  <summary>Care quality & inspections</summary>
                  <section>
                    <div className="section-title">
                      <h3>Published CMS evidence</h3>
                      <span>Data: {provider.cms.dataAsOf}</span>
                    </div>
                    <p className="research-intro">
                      Ratings for this certified nursing home.
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
                        <strong>
                          {metric(provider.cms.healthDeficiencies)}
                        </strong>
                      </div>
                    </div>
                    <details className="evidence-disclosure">
                      <summary>Dates, scope & definitions</summary>
                      <p>
                        CMS ratings apply to this certified nursing home. They
                        do not rate every service or building operated by the
                        same organization.
                      </p>
                      <p>
                        {provider.cms.lastInspection
                          ? `Latest listed health inspection: ${provider.cms.lastInspection}. `
                          : ""}
                        Reporting periods vary by measure. Open the CMS source
                        for definitions, inspection details and any newer data.
                        Zero listed penalties is not proof that care is safe.
                      </p>
                    </details>
                  </section>
                  <InspectionHistory ccn={provider.cms.ccn} />
                </details>
              )}
              {provider.category === "home-health" && (
                <details className="detail-disclosure">
                  <summary>Care quality & patient surveys</summary>
                  <HomeHealthEvidence providerId={provider.id} />
                </details>
              )}
              <details className="detail-disclosure source-disclosure">
                <summary>
                  Sources & dates <span>{provider.sources.length} sources</span>
                </summary>
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
              </details>
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
                  {taskAdded
                    ? "Added to your plan"
                    : "Add a follow-up to my plan"}
                </button>
              </section>
            </div>
          </div>
          <details className="detail-notes">
            <summary>Your questions & notes</summary>
            <p className="small muted">
              Research questions only. Leave out sensitive personal information.
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
          </details>
        </div>
      </div>
    </Modal>
  );
}
