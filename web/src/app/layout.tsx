import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { BottomNav, SelfHostIcon, TopNav } from "@/components/Nav";
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
      <a href="/setup" className="underline hover:text-white">
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
    <a href={demo ? "/login" : "/logout"} className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600 hover:text-white">
      {demo ? "Sign in" : "Sign out"}
    </a>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full overflow-x-hidden bg-zinc-950 text-zinc-100">
        <Suspense fallback={null}>
          <DemoBanner />
        </Suspense>
        <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 md:px-5">
            <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight whitespace-nowrap">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
              Tesla Tracks
            </Link>
            <TopNav />
            <div className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap">
              <SelfHostIcon />
              <Suspense fallback={null}>
                <AuthLink />
              </Suspense>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pt-6 pb-28 md:px-5 md:py-8">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
