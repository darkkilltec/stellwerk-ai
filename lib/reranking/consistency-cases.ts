// Judge consistency cases: the score must agree with the judge's own
// missing_requirements verdict. Born from a real finding — a candidate
// missing ALL three mandatory skills scored 70 ("strong fit"). Shared by
// eval:judge and the prompt lab, which uses them as its test gate.

export const CONSISTENCY_JOB =
  "Benötigt wird zwingend Go, Docker und Linux-Kenntnisse.";

export type ConsistencyCase = {
  name: string;
  profile: string;
  check: (score: number, missing: string[]) => string | null;
};

export const CONSISTENCY_CASES: ConsistencyCase[] = [
  {
    name: "alle Kernanforderungen erfüllt",
    profile:
      "Backend-Engineer mit 7 Jahren Erfahrung in Go, Docker und Linux-Serveradministration, dazu Kubernetes und PostgreSQL.",
    check: (score, missing) => {
      if (score < 80) return `Score ${score} < 80 trotz voller Abdeckung`;
      if (missing.length > 0)
        return `missing nicht leer: ${missing.join(", ")}`;
      return null;
    },
  },
  {
    name: "eine von drei Kernanforderungen",
    profile:
      "Backend-Engineer mit Fokus auf Go und PostgreSQL, Erfahrung mit ereignisgetriebenen Architekturen und CI/CD.",
    check: (score) => {
      if (score > 69)
        return `Score ${score} > 69 trotz fehlender Kernanforderungen`;
      return null;
    },
  },
  {
    name: "keine der Kernanforderungen (fachfremd)",
    profile:
      "BI-Analystin mit Schwerpunkt Power BI, Tableau, DAX und Data Storytelling. Baut Self-Service-Dashboards für das Controlling.",
    check: (score, missing) => {
      if (score >= 40)
        return `Score ${score} >= 40 obwohl alle Kernanforderungen fehlen`;
      if (missing.length < 2)
        return `nur ${missing.length} missing-Eintrag/Einträge`;
      return null;
    },
  },
];
