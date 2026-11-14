import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { marked } from "marked";
import CopyButton from "@/components/CopyButton";

export const metadata: Metadata = {
  title: "Run Tesla Tracks with your own Tesla",
  description: "Give your AI agent one prompt to self-host Tesla Tracks on your server.",
};

const REPO = "https://github.com/victoriano/tesla-tracks";

export default async function SetupPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const guideUrl = `${proto}://${host}/agent-setup.md`;
  const md = await fs.readFile(path.join(process.cwd(), "public", "agent-setup.md"), "utf8");
  // Our own file, rendered on the server; drop the H1, the page has its own.
  const html = await marked.parse(md.replace(/^# .*\n/, ""));

  const prompt = [
    "Set up Tesla Tracks, a self-hosted logger for my Tesla, on my own server.",
    `Follow this guide step by step: ${guideUrl}`,
    "Start by asking me the Phase 0 questions. Ask for my approval before anything that costs money,",
    "creates accounts or apps, changes DNS, opens ports or edits my web server config, and never put",
    "secrets (keys, client secret, tokens, passwords) in the chat or in git.",
  ].join(" ");

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <section className="space-y-3 pt-4">
        <h1 className="text-3xl font-semibold tracking-tight">Run Tesla Tracks with your own Tesla</h1>
        <p className="text-zinc-400">
          Tesla Tracks is open source and runs on your own server: the car streams to it with Tesla&apos;s official
          Fleet Telemetry, your data stays yours. You don&apos;t need to do the setup by hand: give the prompt below
          to your AI coding agent (Claude Code, Codex, Cursor…) with access to your server, and it will walk you
          through it.
        </p>
      </section>

      <section className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Paste this to your agent</h2>
          <CopyButton text={prompt} label="Copy prompt" />
        </div>
        <p className="font-mono text-sm leading-relaxed break-words text-zinc-200">{prompt}</p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card title="Your agent will ask you">
          <li>Which server, and how to reach it (SSH)</li>
          <li>Your domain and who manages its DNS</li>
          <li>Your web server, if you already run one</li>
          <li>The car&apos;s region and who may sign in</li>
          <li>Optional: S3/R2 bucket, currency, time zone</li>
        </Card>
        <Card title="You will do yourself">
          <li>Create the app at developer.tesla.com and add a payment method</li>
          <li>Approve access with your Tesla account</li>
          <li>Pair the virtual key: open a link on your phone next to the car</li>
          <li>Go for a drive 🚗</li>
        </Card>
        <Card title="What you need">
          <li>A Linux server with Docker and a public IP</li>
          <li>A domain you control</li>
          <li>Car firmware 2024.26 or newer</li>
          <li>About 30–60 minutes</li>
          <li>Cost: usually within Tesla&apos;s monthly API credit</li>
        </Card>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">The guide your agent follows</h2>
          <span className="text-sm text-zinc-500">
            <a href="/agent-setup.md" className="hover:text-zinc-300">
              Raw markdown
            </a>{" "}
            ·{" "}
            <a href={REPO} className="hover:text-zinc-300">
              GitHub
            </a>
          </span>
        </div>
        <article
          className="guide rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-6"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h3 className="mb-2 text-sm font-medium text-zinc-300">{title}</h3>
      <ul className="list-disc space-y-1 pl-4 text-sm text-zinc-400">{children}</ul>
    </div>
  );
}
