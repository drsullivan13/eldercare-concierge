import Link from "next/link";
export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${dark ? "brand-light" : ""}`}
      aria-label="Harbor home"
    >
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M6 23V10m10 13V5m10 18V10M6 17c5-6 15-6 20 0M4 26c8 3 16 3 24 0"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span>
        harbor<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
