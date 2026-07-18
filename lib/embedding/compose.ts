import { createHash } from "node:crypto";

// The single place that decides WHAT gets embedded. Candidate names and
// company names are deliberately excluded: they carry no matching signal,
// and keeping them out of the embedding is the first concrete bias
// safeguard — before any bias eval exists.

export function composeCandidateText(candidate: { profile: string }): string {
  return candidate.profile.trim();
}

export function composeJobText(job: {
  title: string;
  description: string;
}): string {
  return `${job.title}\n\n${job.description}`.trim();
}

// Hash of the canonical embed text — stored next to the vector so
// db:embed can tell exactly which rows are stale.
export function embedSourceHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
