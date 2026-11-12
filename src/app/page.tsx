import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
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
        <nav aria-label="Main navigation">
          <Link href="/methodology">How we research care</Link>
          {ACCOUNTS_ENABLED && (
            <Link href="/login" className="login-link">
              Log in
            </Link>
          )}
          <Link
            href={ACCOUNTS_ENABLED ? "/signup" : "/dashboard?demo=1"}
            className="landing-start"
          >
            Find care <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      <main id="main-content">
        <section className="landing-hero">
          <div className="hero-copy">
            <h1>
              A clearer path to your parent’s <em>next chapter.</em>
            </h1>
            <p>
              Explore nearby care options, compare source-linked research, and
              keep your shortlist and next steps together.
            </p>
            <div className="hero-actions">
              <Link
                href={ACCOUNTS_ENABLED ? "/signup" : "/dashboard?demo=1"}
                className="button button-primary"
              >
                {ACCOUNTS_ENABLED
                  ? "Create your care workspace"
                  : "Open your care workspace"}{" "}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              {ACCOUNTS_ENABLED && (
                <Link href="/dashboard?demo=1" className="text-link">
                  Explore the demo <ArrowUpRight size={16} />
                </Link>
              )}
            </div>
            <div className="hero-footnote">
              <ShieldCheck size={18} aria-hidden="true" />{" "}
              {ACCOUNTS_ENABLED
                ? "Official records. Visible sources. Room for questions."
                : "No sign-in needed. Your plan stays in this browser."}
            </div>
          </div>
          <Image
            className="hero-photo"
            src="/images/porch-conversation.webp"
            alt="Two women talking over mugs on a porch."
            width={1120}
            height={747}
            sizes="(max-width: 760px) calc(100vw - 48px), (max-width: 1200px) calc((100vw - 128px) / 2), (max-width: 1280px) calc((100vw - 160px) / 2), 560px"
            loading="eager"
          />
        </section>
        <section className="landing-value">
          <div>
            <span className="eyebrow">A place to begin</span>
            <h2>You don’t have to hold it all in your head.</h2>
          </div>
          <div className="value-grid">
            <article>
              <ShieldCheck aria-hidden="true" />
              <h3>Understand the evidence</h3>
              <p>
                Look beyond a star average. Read inspection, staffing and
                certification information where it’s available.
              </p>
            </article>
            <article>
              <Bookmark aria-hidden="true" />
              <h3>Keep a thoughtful shortlist</h3>
              <p>
                Compare care settings, save questions and keep track of the
                options worth a closer look.
              </p>
            </article>
            <article>
              <ClipboardList aria-hidden="true" />
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
            <h2>Research first. Decisions together.</h2>
            <p>
              Harbor is an early research and planning product. Provider
              availability and individual fit still need a conversation.
            </p>
          </div>
          <Link href="/methodology" className="text-link">
            How we research care <ArrowRight size={18} aria-hidden="true" />
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
