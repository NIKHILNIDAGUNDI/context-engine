# Agentic Context-Engineered Documentation & Codebase Engine

A Next.js App Router application that ingests source files into Supabase/PostgreSQL with pgvector, runs bounded tool-calling retrieval, and presents line-grounded answers alongside a source and execution-trace viewer.

The visual system is defined in `app/globals.css` with matching Figma variables in the `ContextEngine · Obsidian Precision` collection. Core surfaces are `#09090B`, `#101014`, and `#17171D`; emerald denotes verified context, amber denotes citations/abstention, and typography pairs Inter with JetBrains Mono.

## Requirements

- Node.js 22.12+ (required by the current Vitest test runner)
- A Supabase project with the SQL Editor available
- A Groq API key for agent chat and a Gemini API key for embeddings

## Setup

1. Install dependencies with `npm install`.
2. In the Supabase SQL Editor, run `supabase/schema.sql` as a project administrator. This enables pgvector and creates the source/chunk tables, HNSW vector index, and `hybrid_search` RPC. If you already created the older IVFFlat index, run `supabase/migrations/20261116_hnsw_vector_index.sql` once to replace that index; it does not delete indexed documents.
3. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, and a random `CONTEXT_ENGINE_ACCESS_KEY` of at least 32 characters. Create a Groq API key in [Groq Console](https://console.groq.com/keys) and a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey). Keep all keys except the Supabase project URL server-side; never expose or commit them. The access key gates the app behind an HttpOnly, SameSite=Strict, signed session cookie that expires after 12 hours.
4. Start the app with `npm run dev`, then open the displayed local URL.
5. Select **Seed Sample Repo** to index the four demonstration files. Use the suggested question to see multi-hop retrieval, citations, and highlighted source lines.

Agent tool-calling, relevance grading, and grounded synthesis use the Groq Chat Completions API with `GROQ_MODEL` (defaults to `openai/gpt-oss-120b`). GPT-OSS supports tool use and strict JSON Schema outputs but not parallel tool calls, so the agent runs its retrieval calls serially on this model; other configured models use parallel calls. Structured responses are validated with Zod before acceptance. `GROQ_API_KEY` is only used server-side. Gemini remains the embedding provider: `GEMINI_API_KEY` is used by server-side ingestion and retrieval to call `gemini-embedding-001` with `outputDimensionality: 1536`, matching the existing `vector(1536)` schema. Switching the agent provider does not require re-indexing files or migrating vectors. Both provider clients retry transient rate-limit/service errors with bounded backoff.

For production, deploy the Next.js app and configure the same environment variables in the hosting provider's secret store. The Supabase service-role key bypasses row-level security, so it is only read by server routes and must not be prefixed with `NEXT_PUBLIC_`. Apply the updated schema to enable RLS and revoke direct `anon`/`authenticated` access. Built-in login and API rate limits are per-process; use shared rate limiting at the edge for multi-instance deployments.

## API

- All data routes require signing in with `CONTEXT_ENGINE_ACCESS_KEY`; `GET /api/auth/session` checks session status, while `/api/auth/login` and `/api/auth/logout` create and clear the session.
- `POST /api/ingest` accepts either `{ "files": [{ "file_path": "src/file.ts", "raw_content": "..." }] }` or multipart form data with repeated `files` entries. Multipart uploads parse PDF, DOCX, TXT, Markdown/MDX, common code, JSON, CSV, YAML, HTML, and XML sources (10 MB per file, 20 files and 20 MB aggregate per request; 256 chunks maximum), then stream NDJSON progress events for chunking, embedding, and indexing.
- `POST /api/agent-chat` accepts `{ "question": "..." }`; it returns a structured answer, validated citations, at most three tool iterations, and context/pruning trace statistics.
- `POST /api/seed` ingests the four interconnected demo files.
- `GET /api/files` returns indexed source files and their line/chunk counts; `DELETE /api/files?file_path=...` removes a file and its chunks.

PDF extraction preserves page markers (`--- Page N ---`) in the line-indexed source. Image-only/scanned PDFs need OCR before upload. Markdown chunks begin at headings outside fenced code blocks. Code chunks begin at detected top-level declarations. Both use 1-indexed inclusive line bounds. Retrieval combines vector and PostgreSQL full-text ranks with reciprocal-rank fusion.

The retrieval trace reports Groq input and output token usage. Groq pricing varies by model and account tier; check [current Groq pricing](https://groq.com/pricing/) rather than relying on a hard-coded estimate. Embedding requests continue to incur Gemini usage.

## Validation

Run focused tests with `npm test` and the production compiler/bundler with `npm run build`.
