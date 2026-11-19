# Reported Errors and Resolutions

This note summarizes the errors reported after Supabase connectivity was restored, along with what was learned and changed. It distinguishes confirmed causes from issues that still need a live provider check.

## 1. Supabase search returned no matches

**Symptom:** The project could connect to Supabase, but hybrid search returned no chunks.

**Finding:** The index was IVFFlat with 100 lists while the table contained only two chunks. That configuration was poorly suited to such a small index and returned no matches.

**Resolution:** The HNSW migration was applied. A later call to the hybrid-search RPC returned the indexed chunks. The exact SQL-editor error text from the earlier screenshots is not present in the retained conversation, so it cannot be quoted here.

## 2. Gemini structured-output and function-call requests failed

**Symptom:** Gemini requests using structured JSON output and function calling were rejected.

**Finding:** The SDK was using the `v1` API, which did not support the features being exercised.

**Resolution:** Switched the Gemini client to `v1beta`; the JSON-mode and function-call probes then succeeded.

## 3. Gemini agent requests returned HTTP 429

**Symptom:** Agent requests failed with a Gemini quota/rate-limit response.

**Resolution:** Moved agent chat, tool calling, relevance grading, and synthesis to Groq. Gemini remains in use for embeddings at 1536 dimensions, so the existing Supabase vector schema does not need migration.

## 4. Groq reported the configured model as unavailable

**Symptom:** The app displayed that `llama-3.3-70b-versatile` was unavailable.

**Finding and resolution:** That model was not enabled for the configured Groq account. The default was changed to `openai/gpt-oss-120b`. Because GPT-OSS does not support parallel tool calls, the agent uses serial retrieval calls with that model.

## 5. Groq errors were initially described as quota exhaustion

**Symptom:** The UI displayed a Groq quota/rate-limit message, and the user noted there had been only one app request and usage was far below the limit.

**Finding:** The earlier 429 did not include enough captured detail to determine its cause. A later server log showed a **different error: HTTP 400, code `json_validate_failed`, type `invalid_request_error`**. Its headers showed 990 requests and 3,391 tokens remaining, so that 400 was not evidence of quota exhaustion.

**Resolution:** The 429 diagnostic was changed so it no longer assumes the account quota is exhausted. Safe provider codes and rate-limit headers are now logged, and retries honor Groq's retry/reset headers.

## 6. Groq JSON validation failed

**Symptom:** Groq rejected a request with `json_validate_failed`.

**Resolution:** Replaced Groq's older JSON-object mode with strict JSON Schema output for relevance grading and synthesis, while retaining Zod validation of responses. The code and production build passed, but a live Groq request after this change was not verified in this environment.

## 7. A request succeeded but the agent abstained on a PDF summary

**Symptom:** The API returned HTTP 200, but the answer was “Insufficient context in the indexed documentation to verify an answer.”

**Finding:** The PDF had 457 lines but only two indexed chunks. The request used three retrieval hops and nearly the full 4,000-token evidence budget, but the retrieved evidence was not sufficient to support a whole-document summary.

**Status:** This is the app's strict-grounding behavior, not an API failure. More complete PDF chunking/retrieval coverage—or a narrower question—is needed for a reliable full-document summary. The exact reason for that particular abstention was not independently verified.

## Verification and caveats

- The reported code changes passed the project tests, TypeScript check, and production build at the time.
- No live Groq request was made to verify the strict JSON Schema change.
- The original SQL-editor messages from the screenshots were not retained verbatim; the search-index issue above is the confirmed Supabase problem from the later RPC check.
