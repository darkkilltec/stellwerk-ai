# stellwerk-ai

[🇩🇪 Deutsch](README.md) · 🇬🇧 English

![CI](https://github.com/darkkilltec/stellwerk-ai/actions/workflows/ci.yml/badge.svg)

**AI-powered candidate matching for recruiting teams — fair by design.**

stellwerk-ai finds the best-fitting candidates in your own database for a given job posting — and explains every verdict: score, reasoning, and what exactly is missing from the profile. The AI never sees names, origin, age, or family status: resumes are anonymized automatically on import, and the evaluation is strictly name-blind. A built-in bias eval proves it.

## What it does

- **Matching:** Pick a job (or describe one freely) → ranked candidates in seconds, scored by semantic search fused with full-text search.
- **AI evaluation:** One click and an LLM judges every hit like a strict, fair recruiter — score (0–100), a two-sentence reasoning, and the list of missing requirements. Verdicts stream into the page live.
- **Resume upload:** Upload a PDF → text is extracted, **anonymized** (name, contact data, age, family status, employer names removed) and structured into the form — for human review before anything is saved.
- **Interview guides:** Per candidate, the AI generates targeted interview questions — including questions probing exactly the gaps the evaluation found.
- **Evaluation runs:** Judge your *entire* candidate database against one job — runs in the background (even with the browser closed), with live progress, a permanently stored ranking, and a run history. Reruns finish in seconds thanks to caching.
- **Prompt lab:** The judge prompt is configuration, not code — editable in the UI, gated by fixed consistency test cases.

## Up and running in 10 minutes

You need two free programs (about 2 minutes each to install):

| Program | Purpose | Download |
|---|---|---|
| **Bun** | runs the app | [bun.sh](https://bun.sh) |
| **Docker** *or* **Podman** | runs the database | [Docker](https://docs.docker.com/get-docker/) · [Podman](https://podman.io/docs/installation) |

Then, in a terminal (on Windows: use WSL):

```bash
git clone https://github.com/darkkilltec/stellwerk-ai.git
cd stellwerk-ai
bun run setup
```

That's it — setup checks everything, creates demo data (300 candidates, 60 jobs), shows you your login password, and opens the app in your browser. Running it multiple times is safe.

### Enabling the AI features

The AI needs either a local model (free) or an API key:

**Option A — fully local, free** (recommended for trying it out). Install and start [Ollama](https://ollama.com/download) once, then:

```bash
bun run setup:ai
```

Downloads two models (~5.5 GB), configures and live-tests everything. Matching scores, anonymization, interview guides and evaluation runs then work entirely on your machine — no data leaves it.

**Option B — cloud providers** (better quality): Sign in → **Settings** → configure the embedding provider and the judge LLM with your API key (Anthropic, OpenAI, or Voyage). Every configuration is live-tested before it is saved. Then run `bun run db:embed` once.

## Troubleshooting

| Problem | Fix |
|---|---|
| `bun: command not found` | Install Bun ([bun.sh](https://bun.sh)), reopen the terminal |
| "Weder Docker noch Podman gefunden" | Install and start one of the two (links above) |
| Database won't start / port 5432 taken | In `.env`, uncomment `#DB_PORT=5433` and change the port in `DATABASE_URL` to match |
| "Ollama ist nicht erreichbar" | Install and start [Ollama](https://ollama.com/download), rerun `bun run setup:ai` |
| Forgot the password | It's in the `.env` file (`APP_PASSWORD=…`) |
| Matching says no judge LLM is configured | Enable the AI features (see above) |

Still stuck? [Open an issue](https://github.com/darkkilltec/stellwerk-ai/issues) with the error message from your terminal.

## For developers

Next.js (App Router) + Bun + Postgres 17 with [pgvector](https://github.com/pgvector/pgvector), fully containerized. CI runs the full reviewer path on every push: fresh checkout, `docker compose up`, migrations, seed, structural bias check, embedding + matching mechanics against a committed mock provider, and the production image build.

### Daily development

The database always runs in a container; the app runs natively for fast hot reload. `bun dev` starts the DB (Docker or Podman, with a real readiness check) before launching Next:

```bash
bun dev
```

`docker compose up --build` is the smoke test for the path a reviewer takes — run it regularly.

### Schema & migrations

Schema lives in `db/schema.ts` (Drizzle). Migrations in `db/migrations/` are applied automatically at server startup (`instrumentation.ts`) — in dev and in the container alike.

```bash
bun run db:generate    # create a migration from schema changes
bun run db:seed        # demo candidates/jobs (idempotent)
bun run db:demo-data   # synthetic volume (300/60, deterministic via --seed)
bun run db:studio      # browse the DB
```

### AI configuration & evals

```bash
# Configure providers (test-gated — nothing is saved unless a live test passes):
bun run db:configure -- --provider ollama --model snowflake-arctic-embed2
bun run db:configure-rerank -- --provider ollama --model qwen2.5:7b
bun run db:embed       # embed all rows (idempotent; heals after model switches)

bun run eval:matching  # golden-set retrieval (rank, similarity, margin)
bun run eval:recall    # recall@10 of the hybrid search
bun run eval:reranking # two-stage pipeline incl. regression check
bun run eval:judge     # judge consistency on fixed cases
bun run eval:bias      # counterfactual fairness check
```

**Config architecture:** infrastructure config (`DATABASE_URL`) lives in ENV; application config (provider, model, API key) lives encrypted (AES-256-GCM) in the DB behind a test gate — the settings UI and the CLI share the same write path. `db:embed` stores model + source hash per row, so model switches are detected and `eval:matching` refuses to rank across mixed models.

**Hybrid retrieval:** pgvector cosine search fused with Postgres full-text search via Reciprocal Rank Fusion — one SQL query, no extra infrastructure. `eval:recall` measures exactly what this exists for: the share of actually qualified candidates that reach the top 10 the judge gets to see.

**Evaluation pipeline:** verdicts are cached by content + model + prompt hash (`rerank_cache`); any prompt change (including via the prompt lab at `/settings/prompt`) invalidates automatically. Evaluation runs (`/runs`) additionally store durable verdict copies in `evaluation_items` — the archive survives prompt and model switches. The background worker picks up interrupted runs on server boot by itself.

**Anonymization is structural:** candidate names and employer names reach neither the embeddings nor the judge (`composeCandidateText`, name-blind prompts); the resume parser additionally strips all protected attributes from the profile text. `eval:bias` proves both counterfactually.

### Stack notes

- `pgvector/pgvector:pg17` image; the extension is created by `db/init/01-extensions.sql` on first startup.
- App image: multi-stage build on `oven/bun` using Next.js `output: "standalone"`.
- Embeddings are `vector(1024)` columns with HNSW cosine indexes (`EMBEDDING_DIMENSIONS` in `db/schema.ts`).
- `.env` is git-ignored; `.env.example` documents all variables. Secrets reach the container at runtime via `env_file`.
- Ollama from inside `docker compose`: use `http://host.docker.internal:11434`, not `localhost`.
