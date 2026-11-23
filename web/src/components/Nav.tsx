"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BatteryMedium, CircleDot, LayoutDashboard, Route, Users, Zap, type LucideIcon } from "lucide-react";

type Item = { href: string; label: string; icon: LucideIcon };

export const NAV: Item[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/drives", label: "Drives", icon: Route },
  { href: "/battery", label: "Battery", icon: BatteryMedium },
  { href: "/charges", label: "Charges", icon: Zap },
  { href: "/tires", label: "Tires", icon: CircleDot },
  { href: "/drivers", label: "Drivers", icon: Users },
];

function useActive() {
  const path = usePathname();
  return (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
}

/** Desktop: segmented pill nav in the header. */
export function TopNav() {
  const isActive = useActive();
  return (
    <nav className="hidden items-center gap-1 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-1 md:flex">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              active ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100"
            }`}
          >
            <Icon className={`h-4 w-4 ${active ? "text-red-400" : ""}`} strokeWidth={2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile: app-style bottom tab bar. */
export function BottomNav() {
  const isActive = useActive();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800/80 bg-zinc-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="mx-auto grid max-w-md grid-cols-6">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium ${
                active ? "text-white" : "text-zinc-500"
              }`}
            >
              <span className={`rounded-full px-3 py-1 ${active ? "bg-red-500/15 text-red-400" : ""}`}>
                <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
