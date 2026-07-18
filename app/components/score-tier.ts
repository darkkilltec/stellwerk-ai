import type { Dictionary } from "@/lib/i18n";

// Tiers mirror the judge prompt's own scoring guide (90+/70+/40+), so the
// color always means what the number means.
export function scoreTier(
  t: Dictionary["matching"],
  score: number,
): { dot: string; label: string } {
  if (score >= 90) return { dot: "bg-gold", label: t.tierExcellent };
  if (score >= 70) return { dot: "bg-ok", label: t.tierStrong };
  if (score >= 40) return { dot: "bg-warn", label: t.tierPartial };
  return { dot: "bg-danger", label: t.tierWeak };
}
