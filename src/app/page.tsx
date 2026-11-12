import Link from "next/link";
import {
  ArrowRight,
  Check,
  MapPin,
  ShieldCheck,
  ClipboardList,
  Bookmark,
  ArrowUpRight,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { ACCOUNTS_ENABLED } from "@/lib/features";

export default function Home() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand />
        <nav>
          <Link href="/methodology">How we research care</Link>
          {ACCOUNTS_ENABLED && (
            <Link href="/login" className="login-link">
              Log in
            </Link>
          )}
          <Link
            href={ACCOUNTS_ENABLED ? "/signup" : "/dashboard?demo=1"}
            className="button button-dark"
          >
            Get started <ArrowUpRight size={16} />
          </Link>
        </nav>
      </header>
      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="live-dot" /> STARTING IN GREATER BOSTON
            </span>
            <h1>
              A clearer path <br />
              to your parent’s <br />
              <em>next chapter.</em>
            </h1>
            <p>
              Find care you can look into properly. Keep the evidence, the
              options, and the next steps together.
            </p>
            <div className="hero-actions">
              <Link
                href={ACCOUNTS_ENABLED ? "/signup" : "/dashboard?demo=1"}
                className="button button-primary"
              >
                {ACCOUNTS_ENABLED
                  ? "Create your care workspace"
                  : "Open your care workspace"}{" "}
                <ArrowRight size={18} />
              </Link>
              {ACCOUNTS_ENABLED && (
                <Link href="/dashboard?demo=1" className="text-link">
                  Explore the demo <ArrowUpRight size={16} />
                </Link>
              )}
            </div>
            <div className="hero-footnote">
              <ShieldCheck size={16} />{" "}
              {ACCOUNTS_ENABLED
                ? "Official records. Visible sources. Room for questions."
                : "No sign-in needed. Your plan stays in this browser."}
            </div>
          </div>
          <div
            className="hero-visual"
            aria-label="A preview of the Harbor care workspace"
          >
            <div className="visual-kicker">
              <span className="live-dot" /> YOUR CARE WORKSPACE{" "}
              <span>01 / RESEARCH</span>
            </div>
            <div className="visual-title">
              A little more clarity. <br />
              One step at a time.
            </div>
            <div className="abstract-harbor" aria-hidden="true">
              <div className="arch arch-one" />
              <div className="arch arch-two" />
              <div className="arch arch-three" />
              <svg viewBox="0 0 500 200">
                <path
                  d="M-20 150 Q120 80 250 140 T520 110M-20 170 Q120 100 250 160 T520 130M-20 190 Q120 120 250 180 T520 150"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            </div>
            <div className="preview-note">
              <div className="icon-box">
                <MapPin size={22} />
              </div>
              <div>
                <strong>Close to the people who matter.</strong>
                <span>Boston · Newton · North & South Shore</span>
              </div>
            </div>
            <div className="preview-check">
              <span>
                <Check size={15} />
              </span>{" "}
              Know what’s documented—and what to ask next.
            </div>
          </div>
        </section>
        <section className="landing-value">
          <div>
            <span className="eyebrow">THE FIRST PART OF A BIGGER PLAN</span>
            <h2>
              You don’t have to hold <br />
              all of it in your head.
            </h2>
          </div>
          <div className="value-grid">
            <article>
              <span className="value-number">01</span>
              <ShieldCheck />
              <h3>Understand the evidence</h3>
              <p>
                Look beyond a star average. Read inspection, staffing and
                certification information where it’s available.
              </p>
            </article>
            <article>
              <span className="value-number">02</span>
              <Bookmark />
              <h3>Keep a thoughtful shortlist</h3>
              <p>
                Compare care settings, save questions and keep track of the
                options worth a closer look.
              </p>
            </article>
            <article>
              <span className="value-number">03</span>
              <ClipboardList />
              <h3>Make the next step clear</h3>
              <p>
                Build your plan for visits, care, equipment, travel and the
                practical details of a transition.
              </p>
            </article>
          </div>
        </section>
        <section className="landing-bottom">
          <div>
            <span className="eyebrow">A CAREFUL START</span>
            <h2>Research first. Decisions together.</h2>
            <p>
              Harbor is an early research and planning product. Provider
              availability and individual fit still need a conversation.
            </p>
          </div>
          <Link href="/dashboard?demo=1" className="button button-outline">
            Take a look around <ArrowRight size={18} />
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <span>A clearer path to care.</span>
        <Link href="/methodology">Sources & research standards</Link>
      </footer>
    </div>
  );
}
