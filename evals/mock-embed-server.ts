// Mock embedding provider speaking the ollama /api/embed protocol — the
// CI fixture that lets the whole pipeline (configure, embed, matching
// mechanics) run without downloading a real model. Deterministic
// character-trigram hashing into 1024 dims, L2-normalized: cosine
// similarity reflects lexical overlap. Good enough for mechanics, NOT for
// semantic quality — the semantic evals need a real model.
//
//   bun evals/mock-embed-server.ts [port]   (default 11435)

const DIMS = 1024;
const port = Number(process.argv[2] ?? 11435);

function embedText(text: string): number[] {
  const vec = new Array(DIMS).fill(0);
  const s = text.toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i + 3 <= s.length; i++) {
    let h = 5381;
    for (let j = i; j < i + 3; j++) h = ((h * 33) ^ s.charCodeAt(j)) >>> 0;
    vec[h % DIMS] += 1;
  }
  const norm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/api/embed") {
      const body = (await req.json()) as { model: string; input: string[] };
      return Response.json({ embeddings: body.input.map(embedText) });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`mock embed server on :${port}`);
