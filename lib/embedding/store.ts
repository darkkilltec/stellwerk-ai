import { eq } from "drizzle-orm";
import { candidates, jobs } from "@/db/schema";
import { getDb } from "@/lib/db";
import { embedMany } from "./client";
import { embedSourceHash } from "./compose";
import { getValidatedSettings } from "@/lib/settings";

// Embed-on-write: called right after a row is created so new candidates
// and jobs are matchable immediately. Throws on provider failure — the
// caller decides whether that is fatal (the row stays, db:embed heals it).
export async function embedAndStore(
  table: typeof candidates | typeof jobs,
  id: string,
  text: string,
): Promise<void> {
  const cfg = await getValidatedSettings();
  const [vector] = await embedMany([text], "document", cfg);
  await getDb()
    .update(table)
    .set({
      embedding: vector,
      embeddingModel: cfg.model,
      embeddingSourceHash: embedSourceHash(text),
      updatedAt: new Date(),
    })
    .where(eq(table.id, id));
}
