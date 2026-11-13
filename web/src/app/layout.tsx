import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Tesla Tracks",
  description: "Drives and charges streamed from your Tesla",
};

const nav = [
  { href: "/", label: "Overview" },
  { href: "/drives", label: "Drives" },
  { href: "/charges", label: "Charges" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-950 text-zinc-100">
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
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
