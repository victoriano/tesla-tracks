"use client";

import { useState } from "react";

export default function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-400"
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}
