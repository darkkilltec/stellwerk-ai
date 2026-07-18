import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Runs at server startup (see instrumentation.ts). Uses its own
// single connection instead of the app pool, closed when done.
export async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
  } finally {
    await client.end();
  }
}
