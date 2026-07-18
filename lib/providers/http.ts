// Shared HTTP layer for all AI-provider clients (embedding, reranking):
// one error vocabulary, one place that classifies provider failures.

export type ProviderErrorKind =
  | "auth" // key rejected
  | "network" // endpoint unreachable / bad URL
  | "model" // model unknown / not pulled (ollama)
  | "dimension" // embedding-specific: vector length mismatch
  | "parse" // response was not the expected structure
  | "api"; // anything else the provider reported

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

// Generous default: a cold local model may need to load into RAM first.
const REQUEST_TIMEOUT_MS = 120_000;

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new ProviderError(
        "network",
        `No response from ${url} within ${timeoutMs / 1000}s — provider hung or overloaded`,
      );
    }
    throw new ProviderError(
      "network",
      `Cannot reach ${url} — check the URL and that the service is running (${e instanceof Error ? e.message : e})`,
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        "auth",
        `API key rejected (HTTP ${response.status})`,
      );
    }
    if (response.status === 404 || /not found/i.test(text)) {
      throw new ProviderError(
        "model",
        `Model not available (HTTP ${response.status}): ${truncate(text)} — for ollama, pull it first (ollama pull <model>)`,
      );
    }
    throw new ProviderError(
      "api",
      `HTTP ${response.status}: ${truncate(text)}`,
    );
  }
  return response.json();
}

export function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
