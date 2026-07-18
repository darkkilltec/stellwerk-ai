import { parseArgs } from "node:util";
import { closeDb } from "@/lib/db";
import type { RerankConfig, RerankProvider } from "@/lib/reranking/client";
import { testAndSaveRerankConfig } from "@/lib/settings";

// CLI write path for the re-ranking (judge) configuration — the settings
// wizard is the same flow with a UI: test the config with a real
// judgment, and only persist it (encrypted) when the test is green.
//
//   bun run db:configure-rerank -- --provider anthropic --model claude-haiku-4-5-20251001 --key sk-ant-…
//   bun run db:configure-rerank -- --provider ollama --model qwen2.5:7b
//   bun run db:configure-rerank -- --provider openai --model gpt-4o-mini --key sk-…

const PROVIDERS: RerankProvider[] = ["anthropic", "ollama", "openai"];

function usageError(message: string): never {
  console.error(`✗ ${message}`);
  console.error(
    "Usage: bun run db:configure-rerank -- --provider <anthropic|ollama|openai> --model <name> [--key <api-key>] [--base-url <url>]",
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

const provider = values.provider as RerankProvider | undefined;
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

const cfg: RerankConfig = {
  provider,
  model: values.model,
  apiKey: values.key,
  baseUrl: values["base-url"],
};

console.log(`Testing ${provider} / ${cfg.model} …`);
try {
  const result = await testAndSaveRerankConfig(cfg);
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
