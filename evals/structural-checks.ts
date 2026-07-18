import {
  composeCandidateText,
  composeJobText,
} from "@/lib/embedding/compose";

// The structural half of the bias line, shared by eval:structure (CI,
// no model needed) and eval:bias: names and companies must provably
// never reach the embed text.
export function structuralViolations(
  candidateRows: { name: string; profile: string }[],
  jobRows: { title: string; description: string; company: string | null }[],
): string[] {
  const violations: string[] = [];
  for (const row of candidateRows) {
    const text = composeCandidateText(row);
    for (const token of row.name.split(/\s+/)) {
      // Word-boundary match: the name "Ana" must not flag "Analyst".
      const word = new RegExp(
        `\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      );
      if (token.length > 2 && word.test(text)) {
        violations.push(
          `candidate name token "${token}" reaches the embed text`,
        );
      }
    }
  }
  for (const row of jobRows) {
    if (row.company && composeJobText(row).includes(row.company)) {
      violations.push(`company "${row.company}" reaches the embed text`);
    }
  }
  return violations;
}
