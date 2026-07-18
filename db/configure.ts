import { parseArgs } from "node:util";
import { closeDb } from "@/lib/db";
import type {
  EmbeddingConfig,
  EmbeddingProvider,
} from "@/lib/embedding/client";
import { testAndSaveEmbeddingConfig } from "@/lib/settings";

// CLI write path for the embedding configuration — the later settings
// wizard is the same flow with a UI: test the config, and only persist
// it (encrypted) when the test is green.
//
//   bun run db:configure -- --provider openai --model text-embedding-3-small --key sk-…
//   bun run db:configure -- --provider ollama --model snowflake-arctic-embed2 --base-url http://localhost:11434
//   bun run db:configure -- --provider voyage --model voyage-3 --key pa-…

const PROVIDERS: EmbeddingProvider[] = ["openai", "ollama", "voyage"];

function usageError(message: string): never {
  console.error(`✗ ${message}`);
  console.error(
    "Usage: bun run db:configure -- --provider <openai|ollama|voyage> --model <name> [--key <api-key>] [--base-url <url>]",
  );
  process.exit(1);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    provider: { type: "string" },
    model: { type: "string" },
    key: { type: "string" },
    "base-url": { type: "string" },
  },
});

const provider = values.provider as EmbeddingProvider | undefined;
if (!provider || !PROVIDERS.includes(provider)) {
  usageError(`--provider must be one of: ${PROVIDERS.join(", ")}`);
}
if (!values.model) {
  usageError("--model is required");
}
if (provider !== "ollama" && !values.key) {
  usageError(`--key is required for provider "${provider}"`);
}
if (provider === "ollama" && values.key) {
  usageError('provider "ollama" takes no --key');
}

const cfg: EmbeddingConfig = {
  provider,
  model: values.model,
  apiKey: values.key,
  baseUrl: values["base-url"],
};

console.log(`Testing ${provider} / ${cfg.model} …`);
try {
  const result = await testAndSaveEmbeddingConfig(cfg);
  if (!result.ok) {
    console.error(`✗ Test failed [${result.kind}]: ${result.error}`);
    console.error("Nothing was saved.");
    process.exitCode = 1;
  } else {
    console.log(
      `✓ Saved: ${provider} / ${cfg.model} (test ${result.latencyMs}ms)`,
    );
  }
} finally {
  await closeDb();
}
