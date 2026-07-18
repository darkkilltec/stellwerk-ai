import { postJson, ProviderError } from "@/lib/providers/http";

export type ChatProvider = "anthropic" | "ollama" | "openai";

export type ChatConfig = {
  provider: ChatProvider;
  model: string;
  apiKey?: string; // anthropic, openai
  baseUrl?: string; // ollama only
};

// One provider-dispatched chat call that must answer with a single JSON
// object — shared by the judge, the resume parser and the interview
// generator. `ollamaSchema` is enforced via ollama's `format` parameter;
// openai gets json_object mode, anthropic prompt discipline.
export async function completeJson(
  cfg: ChatConfig,
  systemPrompt: string,
  userPrompt: string,
  ollamaSchema: object,
  maxTokens = 500,
): Promise<string> {
  switch (cfg.provider) {
    case "anthropic": {
      const data = await postJson(
        "https://api.anthropic.com/v1/messages",
        {
          model: cfg.model,
          max_tokens: maxTokens,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        },
        {
          "x-api-key": cfg.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
      );
      const content = (data as { content: { type: string; text?: string }[] })
        .content;
      const text = content?.find((c) => c.type === "text")?.text;
      if (!text) throw new ProviderError("parse", "Empty model response");
      return text;
    }
    case "openai": {
      const data = await postJson(
        "https://api.openai.com/v1/chat/completions",
        {
          model: cfg.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        },
        { Authorization: `Bearer ${cfg.apiKey ?? ""}` },
      );
      const text = (
        data as { choices: { message: { content: string | null } }[] }
      ).choices?.[0]?.message?.content;
      if (!text) throw new ProviderError("parse", "Empty model response");
      return text;
    }
    case "ollama": {
      const baseUrl = (cfg.baseUrl ?? "http://localhost:11434").replace(
        /\/$/,
        "",
      );
      const data = await postJson(`${baseUrl}/api/chat`, {
        model: cfg.model,
        stream: false,
        format: ollamaSchema,
        // Thinking models (qwen3, deepseek-r1) would burn 30-60s on a
        // reasoning chain before the schema-constrained JSON; the JSON
        // answer is what we consume. Non-thinking models ignore this.
        think: false,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      const text = (data as { message?: { content?: string } }).message
        ?.content;
      if (!text) throw new ProviderError("parse", "Empty model response");
      return text;
    }
  }
}
