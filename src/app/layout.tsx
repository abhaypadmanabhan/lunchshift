import type { Metadata } from "next";
import localFont from "next/font/local";
import { DM_Mono } from "next/font/google";
import "./globals.css";

// Switzer (Fontshare FFL, licence beside the file) for all UI and body text.
const switzer = localFont({
  src: "./fonts/Switzer-Variable.woff2",
  variable: "--font-switzer",
  weight: "100 900",
  display: "swap",
});

// DM Mono only for literal audit values: ids, SKUs, versions, log lines.
const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // Absolute links for the link-preview image; Railway sets RAILWAY_PUBLIC_DOMAIN.
  metadataBase: new URL(
    process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:3000"),
  ),
  title: "LunchShift",
  description:
    "A parent's school-lunch grocery agent: refuses unsafe substitutes, swaps the whole lunch, and verifies one pickup hold.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${switzer.variable} ${dmMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
