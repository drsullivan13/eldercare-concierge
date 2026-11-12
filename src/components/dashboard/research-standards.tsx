import Link from "next/link";
import { ExternalLink, Info, ShieldCheck } from "lucide-react";

export function EvidenceStandards() {
  return (
    <>
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">HOW WE RESEARCH CARE</span>
          <h1>
            Look beyond <em>the stars.</em>
          </h1>
          <p>
            Useful evidence, honest limits and better questions for the next
            conversation.
          </p>
        </div>
        <ShieldCheck size={40} className="standards-emblem" />
      </div>
      <div className="standards-intro">
        <h2>
          A record is a starting point. <br />A source is something you can
          check.
        </h2>
        <p>
          Harbor does not label a provider “the best” because it has a good
          review average. We bring together public records and provider
          information, identify which claims each source supports, and show the
          questions that remain.
        </p>
      </div>
      <div className="standards-grid">
        {[
          {
            n: "01",
            title: "Regulatory records",
            text: "CMS nursing-home records and Massachusetts assisted-living listings establish distinct types of public evidence. A listing alone does not prove high-quality care.",
            tag: "Available now",
          },
          {
            n: "02",
            title: "Inspections & staffing",
            text: "For nursing homes, published inspections, staffing, turnover and penalties provide context that a review average misses. Reporting dates and limitations stay visible.",
            tag: "Available for nursing homes",
          },
          {
            n: "03",
            title: "Care fit & service coverage",
            text: "Provider websites describe services and areas served. These are provider claims. Confirm the specific needs, address, schedule and availability directly.",
            tag: "Provider information, labeled",
          },
          {
            n: "04",
            title: "Experience, with context",
            text: "Public review averages and selected accounts show different perspectives. The provisional 10-point index groups syndicated sources and leaves thin or ambiguous evidence unrated. CMS patient surveys stay separate.",
            tag: "Sources, dates and exclusions visible",
          },
        ].map((item) => (
          <article key={item.n}>
            <span>{item.n}</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <small>{item.tag}</small>
          </article>
        ))}
      </div>
      <section className="standards-bottom">
        <Info size={22} />
        <div>
          <h3>How ordering works today</h3>
          <p>
            Results start with distance. Nursing-home searches can also use the
            published CMS overall rating, with distance breaking ties and
            missing ratings last. Within a care category, you can also sort the
            consumer experience index. It summarizes eligible public ratings,
            not clinical quality or safety. Missing evidence is not a poor
            rating, and no provider pays for placement.
          </p>
          <Link className="text-link" href="/methodology" target="_blank">
            Read the full methodology & source library{" "}
            <ExternalLink size={15} />
          </Link>
        </div>
      </section>
    </>
  );
}
