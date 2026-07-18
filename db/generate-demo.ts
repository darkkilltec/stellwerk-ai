import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { candidates, jobs } from "./schema";

// Deterministic synthetic demo data at scale — makes the vector search
// real (HNSW over hundreds of rows) without an LLM. Niches are deliberately
// DISJOINT from the golden-set niches so eval:matching/eval:reranking stay
// meaningful. Reproducible via --seed. Rows get no slug (seeds/evals only).
//
//   bun run db:demo-data -- --candidates 300 --jobs 60 --seed 42
//   bun run db:embed   # afterwards, to embed the new rows

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    candidates: { type: "string", default: "300" },
    jobs: { type: "string", default: "60" },
    seed: { type: "string", default: "42" },
  },
});

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(Number(values.seed));
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const pickN = <T>(arr: T[], n: number): T[] =>
  [...arr].sort(() => rand() - 0.5).slice(0, n);
const int = (min: number, max: number) =>
  min + Math.floor(rand() * (max - min + 1));

const FIRST_NAMES = [
  "Deniz", "Miriam", "Tobias", "Fatma", "Jan", "Ana", "Piotr", "Leyla",
  "Felix", "Chiara", "Nguyen", "Katharina", "Omar", "Ines", "Lukas",
  "Zeynep", "Martin", "Olga", "Samuel", "Ricarda", "Amir", "Helene",
  "Davide", "Nora", "Sebastian", "Aisha", "Georg", "Tamara", "Kwame",
  "Franziska", "Ivan", "Melis", "Paul", "Dilara", "Christoph", "Yara",
];
const LAST_NAMES = [
  "Schneider", "Yilmaz", "Kowalski", "Weber", "Rossi", "Nguyen", "Fischer",
  "Demir", "Wagner", "Novak", "Becker", "Haddad", "Hoffmann", "Petrov",
  "Schulz", "Öztürk", "Koch", "Silva", "Bauer", "Janssen", "Richter",
  "Aydin", "Klein", "Moreau", "Wolf", "Ivanova", "Neumann", "Sato",
  "Schwarz", "Lindgren", "Zimmermann", "Costa", "Braun", "Ali", "Krüger",
];

type Niche = {
  role: string;
  skills: string[];
  domains: string[];
  jobTitles: string[];
  companies: string[];
  requirements: string[];
};

// All niches intentionally outside the golden set's five fields.
const NICHES: Niche[] = [
  {
    role: "Mobile-Entwickler:in",
    skills: ["Swift", "SwiftUI", "Kotlin", "Jetpack Compose", "Flutter", "React Native", "App-Store-Releases", "Push-Notifications"],
    domains: ["Consumer-Apps", "Banking-Apps", "Fitness-Tracking", "Mobilitäts-Apps"],
    jobTitles: ["iOS Developer", "Android Engineer", "Mobile Engineer (Flutter)"],
    companies: ["Appwerk Studio", "Mobilion GmbH", "Pocketline AG"],
    requirements: ["native iOS- oder Android-Entwicklung", "App-Store-Deployment-Prozesse", "Offline-Sync und Push-Infrastruktur"],
  },
  {
    role: "Data Engineer",
    skills: ["Apache Spark", "Airflow", "dbt", "Snowflake", "Kafka Streams", "Python", "Delta Lake", "BigQuery"],
    domains: ["Retail-Datenplattform", "IoT-Telemetrie", "Marketing-Analytics", "Logistik-Datenströme"],
    jobTitles: ["Data Engineer", "Analytics Engineer", "Data Platform Engineer"],
    companies: ["Datenwerk Nord", "Streamfabrik GmbH", "Insight Labs"],
    requirements: ["ETL/ELT-Pipelines in Produktion", "Data-Warehouse-Modellierung", "Orchestrierung mit Airflow oder Dagster"],
  },
  {
    role: "QA-Engineer",
    skills: ["Playwright", "Cypress", "Selenium", "Testautomatisierung", "API-Testing", "Loadtests mit k6", "ISTQB"],
    domains: ["E-Health-Software", "Versicherungsportale", "Buchungssysteme"],
    jobTitles: ["QA Automation Engineer", "Test Engineer", "SDET"],
    companies: ["Qualitecs", "Prüfwerk Software", "Testhaus Berlin"],
    requirements: ["Testautomatisierung im CI-Betrieb", "Teststrategien für Regressionssuiten", "API- und E2E-Testabdeckung"],
  },
  {
    role: "Security-Engineer",
    skills: ["Penetrationstests", "OWASP", "Burp Suite", "SIEM", "Incident Response", "IAM-Härtung", "Threat Modeling"],
    domains: ["KRITIS-Umgebungen", "SaaS-Security", "Behörden-IT"],
    jobTitles: ["Security Engineer", "AppSec Engineer", "SOC Analyst (Senior)"],
    companies: ["Schildwache IT", "SecureStack GmbH", "NordCERT"],
    requirements: ["Security-Assessments und Pentests", "Secure-SDLC-Integration", "Incident-Response-Prozesse"],
  },
  {
    role: "SAP-Berater:in",
    skills: ["ABAP", "S/4HANA", "SAP FI/CO", "SAP MM", "Fiori", "IDoc-Schnittstellen", "SAP BTP"],
    domains: ["Automobilzulieferer", "Handelskonzerne", "Pharmalogistik"],
    jobTitles: ["SAP ABAP Developer", "SAP S/4HANA Consultant", "SAP Inhouse Consultant"],
    companies: ["Konzept & Wandel Consulting", "ERP-Werk", "Hansa Business Systems"],
    requirements: ["S/4HANA-Migrationsprojekte", "ABAP-Entwicklung und Debugging", "Modulbetreuung FI/CO oder MM"],
  },
  {
    role: "Embedded-Entwickler:in",
    skills: ["C++", "C", "RTOS", "CAN-Bus", "AUTOSAR", "Yocto", "Unit-Tests mit gtest", "MISRA"],
    domains: ["Automotive-Steuergeräte", "Medizintechnik-Firmware", "Industrieautomatisierung"],
    jobTitles: ["Embedded Software Engineer", "Firmware Developer", "C++ Entwickler Embedded"],
    companies: ["Steuerbar GmbH", "MedTech Embedded", "Antrieb & Logik AG"],
    requirements: ["hardwarenahe C/C++-Entwicklung", "Debugging auf Zielhardware", "Normkonforme Entwicklung (MISRA/IEC 62304)"],
  },
  {
    role: "BI-Analyst:in",
    skills: ["Power BI", "Tableau", "SQL", "DAX", "Data Storytelling", "Looker", "Excel-Modellierung"],
    domains: ["Controlling-Reporting", "Vertriebssteuerung", "Supply-Chain-KPIs"],
    jobTitles: ["BI Analyst", "Reporting Specialist", "Business Intelligence Developer"],
    companies: ["Kennzahlwerk", "Berichtsraum GmbH", "KPI Studio"],
    requirements: ["Self-Service-BI-Dashboards", "Datenmodellierung für Reporting", "Stakeholder-Workshops"],
  },
  {
    role: ".NET-Entwickler:in",
    skills: ["C#", ".NET 8", "ASP.NET Core", "Entity Framework", "Azure DevOps", "Blazor", "SQL Server"],
    domains: ["Warenwirtschaftssysteme", "Behördensoftware", "Facility-Management-Software"],
    jobTitles: [".NET Developer", "C# Backend Engineer", "Fullstack .NET Engineer"],
    companies: ["Fachverfahren Süd", "CoreLogic Software", "Verwalt-IT GmbH"],
    requirements: ["Enterprise-Anwendungen mit ASP.NET Core", "Datenbankdesign mit SQL Server", "CI/CD mit Azure DevOps"],
  },
];

const PREFERENCES = [
  "Bevorzugt remote-first.",
  "Sucht hybride Arbeit im Rhein-Main-Gebiet.",
  "Offen für 4-Tage-Woche.",
  "Möchte mittelfristig Teamverantwortung übernehmen.",
  "Bevorzugt Produktunternehmen statt Agentur.",
  "Sucht ein Team mit starker Code-Review-Kultur.",
];

function candidateProfile(niche: Niche): string {
  const years = int(2, 15);
  const skills = pickN(niche.skills, int(3, 5));
  return (
    `${niche.role} mit ${years} Jahren Erfahrung, Schwerpunkt ${skills.join(", ")}. ` +
    `Zuletzt im Bereich ${pick(niche.domains)} tätig. ${pick(PREFERENCES)}`
  );
}

function jobDescription(niche: Niche): string {
  const reqs = pickN(niche.requirements, 2);
  const skills = pickN(niche.skills, int(3, 4));
  return (
    `Wir suchen Verstärkung im Bereich ${pick(niche.domains)}: ${reqs.join(", ")}. ` +
    `Stack: ${skills.join(", ")}. Erfahrung im Produktionsbetrieb erwünscht.`
  );
}

async function generate() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const candidateCount = Number(values.candidates);
  const jobCount = Number(values.jobs);
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);
  try {
    const candidateRows = Array.from({ length: candidateCount }, () => {
      const niche = pick(NICHES);
      return {
        name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        profile: candidateProfile(niche),
      };
    });
    const jobRows = Array.from({ length: jobCount }, () => {
      const niche = pick(NICHES);
      return {
        title: pick(niche.jobTitles),
        company: pick(niche.companies),
        description: jobDescription(niche),
      };
    });
    for (let i = 0; i < candidateRows.length; i += 100) {
      await db.insert(candidates).values(candidateRows.slice(i, i + 100));
    }
    for (let i = 0; i < jobRows.length; i += 100) {
      await db.insert(jobs).values(jobRows.slice(i, i + 100));
    }
    console.log(
      `[demo-data] inserted ${candidateCount} candidates, ${jobCount} jobs (seed ${values.seed}) — run bun run db:embed next`,
    );
  } finally {
    await client.end();
  }
}

await generate();
