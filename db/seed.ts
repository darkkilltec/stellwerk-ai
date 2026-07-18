import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { candidates, jobs } from "./schema";

// Demo data for local development: text only — embeddings stay null
// until the embedding pipeline exists. Run via `bun run db:seed`.
const seedCandidates: (typeof candidates.$inferInsert)[] = [
  {
    slug: "fullstack-ts",
    name: "Lena Hartmann",
    profile:
      "Full-Stack-Entwicklerin mit 6 Jahren Erfahrung in TypeScript, React und Node.js. " +
      "Zuletzt Tech Lead in einem E-Commerce-Scale-up, Schwerpunkt Checkout und Payment-Integrationen. " +
      "Sucht eine Rolle mit Produktverantwortung, remote-first.",
  },
  {
    slug: "go-platform",
    name: "Murat Özdemir",
    profile:
      "Backend-Engineer mit Fokus auf Go und PostgreSQL, davor 4 Jahre Java/Spring. " +
      "Erfahrung mit ereignisgetriebenen Architekturen (Kafka) und Kubernetes in regulierten Umgebungen (Banking). " +
      "Interessiert an Infrastruktur- und Plattform-Teams.",
  },
  {
    slug: "nlp-data-scientist",
    name: "Sophie Brandt",
    profile:
      "Data Scientist mit Schwerpunkt NLP und Recommender-Systemen, Python, PyTorch, sklearn. " +
      "Promotion in Computerlinguistik, 3 Jahre Industrieerfahrung in einem HR-Tech-Startup. " +
      "Möchte an LLM-gestützten Produkten arbeiten.",
  },
  {
    slug: "devops-sre",
    name: "Jonas Petersen",
    profile:
      "DevOps-Engineer, AWS-zertifiziert, Terraform, GitOps mit ArgoCD, Observability mit Grafana-Stack. " +
      "Hat in zwei Startups CI/CD-Pipelines und Plattform-Tooling von Grund auf aufgebaut. " +
      "Bevorzugt hybride Arbeit im Raum Hamburg.",
  },
  {
    slug: "frontend-design-system",
    name: "Aylin Kaya",
    profile:
      "Frontend-Entwicklerin mit Design-Hintergrund, React, Next.js, Tailwind, Storybook. " +
      "Baut Design-Systeme und barrierefreie Komponentenbibliotheken, zuletzt in einer Agentur für B2B-SaaS-Kunden. " +
      "Sucht ein Produktteam mit hohem UX-Anspruch.",
  },
];

const seedJobs: (typeof jobs.$inferInsert)[] = [
  {
    slug: "checkout-plattform",
    title: "Senior Full-Stack Engineer (TypeScript)",
    company: "Nordlicht Commerce GmbH",
    description:
      "Wir bauen die Checkout-Plattform für mittelständische Händler. " +
      "Stack: Next.js, tRPC, PostgreSQL. Du übernimmst Feature-Verantwortung von der Idee bis zum Rollout, " +
      "arbeitest eng mit Produkt und Design. Remote innerhalb der EU.",
  },
  {
    slug: "fincore-platform",
    title: "Platform Engineer (Go/Kubernetes)",
    company: "FinCore AG",
    description:
      "Regulierte Banking-Plattform sucht Verstärkung fürs Plattform-Team: Go-Services, Kafka, " +
      "Kubernetes on-prem und AWS, hohe Anforderungen an Zuverlässigkeit und Compliance. " +
      "Erfahrung mit PostgreSQL und Infrastructure as Code erwünscht.",
  },
  {
    slug: "matching-ranking",
    title: "Machine Learning Engineer — Matching & Ranking",
    company: "stellwerk.ai",
    description:
      "Du entwickelst unser Kandidaten-Job-Matching weiter: Embedding-Pipelines, Vektor-Suche mit pgvector, " +
      "Ranking-Experimente und Evaluierung. Python und TypeScript im Einsatz, LLM-Erfahrung ein Plus. " +
      "Kleines Team, viel Gestaltungsspielraum.",
  },
  {
    slug: "medidata-sre",
    title: "DevOps / Site Reliability Engineer",
    company: "MediData Systems",
    description:
      "HealthTech-Unternehmen migriert von EC2-Handarbeit zu GitOps: Terraform, ArgoCD, EKS, " +
      "Observability mit Prometheus/Grafana. Du gestaltest die Plattform-Roadmap mit und coachst die Produktteams. " +
      "Hybrid in Hamburg oder remote.",
  },
  {
    slug: "klarwerk-design-system",
    title: "Frontend Engineer — Design System",
    company: "Klarwerk SaaS",
    description:
      "B2B-Analytics-Produkt sucht Frontend-Verstärkung für den Aufbau eines Design-Systems: " +
      "React, Next.js, Tailwind, Storybook, hohe Ansprüche an Accessibility und Performance. " +
      "Enge Zusammenarbeit mit UX, Component-Library als Produkt gedacht.",
  },
];

async function seed() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);
  try {
    const existing = await db.$count(candidates);
    if (existing > 0) {
      console.log(`[seed] skipped — ${existing} candidates already present`);
      return;
    }
    await db.insert(candidates).values(seedCandidates);
    await db.insert(jobs).values(seedJobs);
    console.log(
      `[seed] inserted ${seedCandidates.length} candidates, ${seedJobs.length} jobs`,
    );
  } finally {
    await client.end();
  }
}

await seed();
