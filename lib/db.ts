import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

// Created lazily on first use: DATABASE_URL exists only at runtime,
// not during `next build` (which evaluates this module without a DB).
let client: postgres.Sql | null = null;
let dbInstance: PostgresJsDatabase<typeof schema> | null = null;

function getSql() {
  if (!client) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    client = postgres(process.env.DATABASE_URL);
  }
  return client;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle(getSql(), { schema });
  }
  return dbInstance;
}

// For CLI scripts: close the pool so the process can exit.
export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    dbInstance = null;
  }
}

export type DbStatus = {
  database: string;
  postgresVersion: string;
  vectorVersion: string | null;
  tables: string[];
};

export async function getDbStatus(): Promise<DbStatus> {
  const sql = getSql();
  const [row] = await sql`
    select
      current_database() as database,
      current_setting('server_version') as postgres_version,
      (select extversion from pg_extension where extname = 'vector') as vector_version
  `;
  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `;
  return {
    database: row.database,
    postgresVersion: row.postgres_version,
    vectorVersion: row.vector_version,
    tables: tables.map((t) => t.table_name),
  };
}
