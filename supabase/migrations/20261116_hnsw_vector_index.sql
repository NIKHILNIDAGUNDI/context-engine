-- Replace the sparse IVFFlat index with HNSW, which works reliably for small
-- indexes and does not require tuning the number of lists/probes.
drop index if exists public.doc_chunks_embedding_idx;

create index doc_chunks_embedding_idx on public.doc_chunks
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
