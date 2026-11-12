import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
export const metadata: Metadata = {
  title: "Harbor · A clearer path to care",
  description:
    "Research elder care by ZIP with official records, transparent evidence, and a clear plan for what comes next.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
