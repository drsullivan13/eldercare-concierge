import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  FileSearch,
  Users,
  MessageSquare,
  MapPin,
} from "lucide-react";
import { Brand } from "@/components/brand";
export default function Methodology() {
  return (
    <div className="method-page">
      <header className="landing-nav">
        <Brand />
        <Link className="button button-outline" href="/dashboard?demo=1">
          Explore care <ArrowRight size={16} />
        </Link>
      </header>
      <main className="method-content">
        <Link href="/" className="text-link">
          <ArrowLeft size={16} /> Harbor home
        </Link>
        <span className="eyebrow">OUR RESEARCH STANDARDS · VERSION 1</span>
        <h1>
          Good care deserves <br />
          <em>more than a star average.</em>
        </h1>
        <p className="method-intro">
          A public record can tell you something useful. It cannot tell you
          everything. Harbor makes that distinction visible, so you can ask
          better questions before making a decision.
        </p>
        <div className="method-principles">
          <article>
            <ShieldCheck />
            <h2>Start with official records</h2>
            <p>
              For Medicare- and Medicaid-certified nursing homes, we use CMS
              Care Compare data: published ratings, inspections, staffing,
              turnover and penalties. For assisted living, we use Massachusetts’
              certified-residence records. Assisted living does not have a CMS
              nursing-home rating.
            </p>
          </article>
          <article>
            <FileSearch />
            <h2>Show the evidence behind each claim</h2>
            <p>
              Each provider has source links, a data date where published, and
              the date we retrieved the record. A source link means there is a
              record to inspect. It does not mean Harbor has visited the
              facility, spoken to references or completed an independent vetting
              process.
            </p>
          </article>
          <article>
            <Users />
            <h2>Separate care quality from convenience</h2>
            <p>
              Results start with distance, not a proprietary quality score. You
              can sort nursing homes by their published CMS overall rating, with
              closer locations breaking ties. Missing ratings appear last. An
              assisted-living residence and a home-care agency are never scored
              against a nursing home.
            </p>
          </article>
          <article>
            <MessageSquare />
            <h2>Keep lived experience in context</h2>
            <p>
              Resident and family experiences matter, including complaints and
              how providers respond. This version does not publish a blended
              review score or invent ratings from Google, Yelp or other sites.
              Authorized review feeds and a structured reference-check process
              are planned; they are not connected today.
            </p>
          </article>
          <article>
            <MapPin />
            <h2>Be precise about location</h2>
            <p>
              Search measures straight-line miles from an approximate ZIP
              location, using Census and GeoNames coordinates. It is not driving
              time. A home-care office within the radius does not guarantee that
              the agency serves your address or has staff available.
            </p>
          </article>
        </div>
        <section className="method-callout">
          <h2>What still needs a person</h2>
          <p>
            Current availability, total costs, staffing on the actual shift, the
            ability to meet specific care needs, recent complaints and the
            parent’s preferences all need follow-up. For private staff,
            identity, professional license where applicable, references,
            background checks, insurance and employment arrangements require
            separate checks. A sourcing route is not a vetted candidate.
          </p>
        </section>
        <section className="method-sources">
          <h2>The source library</h2>
          <a
            href="https://data.cms.gov/provider-data/topics/nursing-homes"
            target="_blank"
            rel="noreferrer"
          >
            CMS nursing-home provider data <ArrowRight size={17} />
          </a>
          <a
            href="https://www.mass.gov/assisted-living-residences"
            target="_blank"
            rel="noreferrer"
          >
            Massachusetts assisted-living information <ArrowRight size={17} />
          </a>
          <a
            href="https://data.cms.gov/provider-data/topics/home-health-services"
            target="_blank"
            rel="noreferrer"
          >
            CMS home-health provider data <ArrowRight size={17} />
          </a>
          <a
            href="https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html"
            target="_blank"
            rel="noreferrer"
          >
            US Census Gazetteer files <ArrowRight size={17} />
          </a>
          <a
            href="https://download.geonames.org/export/zip/"
            target="_blank"
            rel="noreferrer"
          >
            GeoNames postal coordinates · CC BY 4.0 <ArrowRight size={17} />
          </a>
        </section>
        <p className="privacy-note">
          No provider pays for placement in these search results. The catalog is
          a dated research snapshot, not a complete inventory of every care
          option or an emergency service.
        </p>
      </main>
    </div>
  );
}
