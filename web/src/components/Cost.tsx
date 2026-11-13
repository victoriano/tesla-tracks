"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Price per kWh used to estimate what a drive cost. Stored in this browser (localStorage) and shared
 * by every page, so changing it once updates all costs. Presets are typical Spanish prices in 2026:
 * rough references, edit them to match your tariff.
 */
export const PRESETS = [
  { id: "home-offpeak", label: "Home, off-peak", price: 0.1 },
  { id: "home", label: "Home", price: 0.18 },
  { id: "supercharger", label: "Supercharger", price: 0.45 },
  { id: "fast", label: "Other fast chargers", price: 0.65 },
] as const;

const KEY = "tt.pricePerKwh";
const EVENT = "tt-price-change";
const DEFAULT_PRICE = PRESETS[1].price;

function read(): number {
  const v = Number(localStorage.getItem(KEY));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PRICE;
}

function write(price: number) {
  localStorage.setItem(KEY, String(price));
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function usePrice(): number {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_PRICE);
}

function money(v: number, currency: string, locale: string, digits = 2) {
  return v.toLocaleString(locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Cost of `kwh` at the selected price. */
export function CostValue({ kwh, currency, locale }: { kwh: number | null; currency: string; locale: string }) {
  const price = usePrice();
  if (kwh === null || !Number.isFinite(kwh)) return <>—</>;
  return <>{money(kwh * price, currency, locale)}</>;
}

/** Inline "0,18 €/kWh ▾" control with presets and a free-form price. */
export function PricePicker({
  currency,
  locale,
  align = "left",
  kwh,
}: {
  currency: string;
  locale: string;
  align?: "left" | "right";
  /** When given, each tariff also shows what this energy would cost with it. */
  kwh?: number | null;
}) {
  const price = usePrice();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const apply = (v: number) => {
    if (Number.isFinite(v) && v > 0 && v < 10) write(Math.round(v * 1000) / 1000);
  };
  const preset = PRESETS.find((p) => Math.abs(p.price - price) < 1e-9);
  const hasKwh = kwh !== undefined && kwh !== null && Number.isFinite(kwh);

  return (
    <div ref={box} className="relative inline-block">
      <button
        onClick={() => {
          setDraft(price.toLocaleString(locale, { maximumFractionDigits: 3 }));
          setOpen((o) => !o);
        }}
        className="whitespace-nowrap rounded-md border border-zinc-700/80 px-1.5 py-0.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
        title={`Price per kWh used for costs${preset ? ` (${preset.label})` : ""}`}
      >
        {money(price, currency, locale)}/kWh ▾
      </button>
      {open ? (
        <div className={`absolute ${align === "right" ? "right-0" : "left-0"} z-20 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-xl`}>
          <div className="mb-1 flex justify-between px-1 text-[11px] uppercase tracking-wide text-zinc-500">
            <span>Electricity price</span>
            {hasKwh ? <span>{(kwh as number).toLocaleString(locale, { maximumFractionDigits: 1 })} kWh would cost</span> : null}
          </div>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                apply(p.price);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-zinc-800 ${
                preset?.id === p.id ? "text-white" : "text-zinc-300"
              }`}
            >
              <span className="flex flex-col items-start">
                <span>{p.label}</span>
                <span className="text-[11px] tabular-nums text-zinc-500">{money(p.price, currency, locale)}/kWh</span>
              </span>
              {hasKwh ? (
                <span className="tabular-nums font-medium">{money(p.price * (kwh as number), currency, locale)}</span>
              ) : null}
            </button>
          ))}
          <form
            className="mt-2 flex items-center gap-2 border-t border-zinc-800 px-1 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              apply(Number(draft.replace(",", ".")));
              setOpen(false);
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              inputMode="decimal"
              aria-label="Custom price per kWh"
              className="w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm tabular-nums text-white outline-none focus:border-zinc-400"
            />
            <span className="text-xs text-zinc-500">{currency}/kWh</span>
            {hasKwh ? (
              <span className="text-xs tabular-nums text-zinc-400">
                = {money(Number(draft.replace(",", ".")) * (kwh as number) || 0, currency, locale)}
              </span>
            ) : null}
            <button type="submit" className="ml-auto rounded-md bg-zinc-700 px-2 py-1 text-xs text-white hover:bg-zinc-600">
              Set
            </button>
          </form>
          <p className="mt-2 px-1 text-[10px] leading-snug text-zinc-500">
            Cost = energy taken from the battery × price. Charging losses (≈10% on AC) are not included.
            Presets are rough references.
          </p>
        </div>
      ) : null}
    </div>
  );
}
