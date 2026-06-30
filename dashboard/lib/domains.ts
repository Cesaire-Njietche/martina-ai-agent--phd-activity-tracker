/**
 * Render the classification domains (see agents/classify.py) as chips that show
 * the actual domain string stored in the DB, colored by the family it belongs
 * to. Domains not recognised below fall back to a neutral gray chip rather than
 * being dropped.
 *   QEC family           -> green
 *   AI family            -> blue
 *   cybersecurity family -> orange
 *   anything else        -> gray
 */
type Family = "qec" | "ai" | "cybersecurity";

const DOMAIN_TO_FAMILY: Record<string, Family> = {
  "quantum error correction": "qec",
  "surface code": "qec",
  "worst-case physical error injection": "qec",
  "neural network": "ai",
  mlp: "ai",
  "adversarial attacks": "cybersecurity",
};

const FAMILY_COLOR: Record<Family, { bg: string; fg: string }> = {
  qec: { bg: "#16a34a", fg: "#ffffff" },
  ai: { bg: "#2563eb", fg: "#ffffff" },
  cybersecurity: { bg: "#ea580c", fg: "#ffffff" },
};

const UNMAPPED_COLOR = { bg: "#64748b", fg: "#ffffff" };

export type DomainChip = { label: string; bg: string; fg: string };

/** One chip per actual DB domain string, deduped, colored by its family. */
export function domainChips(domains: string[] | null | undefined): DomainChip[] {
  const out: DomainChip[] = [];
  const seen = new Set<string>();
  for (const d of domains ?? []) {
    const label = (d ?? "").trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    const family = DOMAIN_TO_FAMILY[key];
    const color = family ? FAMILY_COLOR[family] : UNMAPPED_COLOR;
    out.push({ label, bg: color.bg, fg: color.fg });
  }
  return out;
}
