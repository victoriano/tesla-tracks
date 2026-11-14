import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Tesla Tracks",
  description: "Drives and charges streamed from your Tesla",
};

/** Shown when TT_DEMO=1: a public instance that serves generated data. */
async function DemoBanner() {
  await connection(); // read the env at request time, not at build time
  if (process.env.TT_DEMO !== "1") return null;
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-center text-xs text-amber-200">
      Demo with made-up data for a fictional car.{" "}
      <a href="https://github.com/victoriano/tesla-tracks" className="underline hover:text-white">
        Run Tesla Tracks with your own Tesla →
      </a>
    </div>
  );
}

/**
 * Optional sign-in / sign-out links for a reverse proxy that serves the demo to visitors and the real
 * dashboard after login (see deploy/Caddyfile). Enabled with TT_AUTH_LINKS=1.
 */
async function AuthLink() {
  await connection();
  if (process.env.TT_AUTH_LINKS !== "1") return null;
  const demo = process.env.TT_DEMO === "1";
  return (
    <a href={demo ? "/login" : "/logout"} className="ml-auto text-sm text-zinc-400 hover:text-zinc-100">
      {demo ? "Sign in" : "Sign out"}
    </a>
  );
}

const nav = [
  { href: "/", label: "Overview" },
  { href: "/drives", label: "Drives" },
  { href: "/charges", label: "Charges" },
  { href: "/tires", label: "Tires" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-950 text-zinc-100">
        <Suspense fallback={null}>
          <DemoBanner />
        </Suspense>
        <header className="border-b border-zinc-800/80">
          <div className="mx-auto flex max-w-6xl items-center gap-8 px-5 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              <span className="text-red-500">●</span> Tesla Tracks
            </Link>
            <nav className="flex gap-5 text-sm text-zinc-400">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-zinc-100">
                  {n.label}
                </Link>
              ))}
            </nav>
            <Suspense fallback={null}>
              <AuthLink />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
