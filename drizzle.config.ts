import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    // Only needed for commands that talk to the DB (migrate, studio);
    // `drizzle-kit generate` works without it.
    url: process.env.DATABASE_URL ?? "",
  },
});
