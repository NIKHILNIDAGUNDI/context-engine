create extension if not exists vector;

create table if not exists public.source_files (
  id uuid primary key default gen_random_uuid(),
  file_path text not null unique,
  raw_content text not null,
  line_count integer not null check (line_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.doc_chunks (
  id uuid primary key default gen_random_uuid(),
  file_path text not null references public.source_files(file_path) on delete cascade,
  heading_path text not null,
  start_line integer not null check (start_line >= 1),
  end_line integer not null check (end_line >= start_line),
  content text not null,
  -- Gemini gemini-embedding-001 is configured with outputDimensionality=1536.
  -- This preserves existing vectors and avoids a destructive dimension migration.
  embedding vector(1536) not null,
  fts tsvector generated always as (to_tsvector('english', content)) stored
);

create index if not exists doc_chunks_embedding_idx on public.doc_chunks
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index if not exists doc_chunks_fts_idx on public.doc_chunks using gin (fts);
create index if not exists doc_chunks_file_path_idx on public.doc_chunks(file_path);

alter table public.source_files enable row level security;
alter table public.doc_chunks enable row level security;
revoke all on public.source_files, public.doc_chunks from public, anon, authenticated;
grant all on public.source_files, public.doc_chunks to service_role;

create or replace function public.hybrid_search(
  query_text text,
  query_embedding vector(1536),
  match_count integer default 8
)
returns table (
  id uuid,
  file_path text,
  heading_path text,
  start_line integer,
  end_line integer,
  content text,
  score double precision
)
language sql
stable
as $$
  with vector_results as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as position
    from public.doc_chunks c
    order by c.embedding <=> query_embedding
    limit greatest(match_count, 1)
  ),
  text_results as (
    select c.id, row_number() over (
      order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc
    ) as position
    from public.doc_chunks c
    where c.fts @@ websearch_to_tsquery('english', query_text)
    order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc
    limit greatest(match_count, 1)
  ),
  fused as (
    select coalesce(v.id, t.id) as id,
      coalesce(1.0 / (60 + v.position), 0.0) + coalesce(1.0 / (60 + t.position), 0.0) as score
    from vector_results v
    full outer join text_results t on t.id = v.id
  )
  select c.id, c.file_path, c.heading_path, c.start_line, c.end_line, c.content, f.score
  from fused f
  join public.doc_chunks c on c.id = f.id
  order by f.score desc
  limit greatest(match_count, 1);
$$;

revoke all on function public.hybrid_search(text, vector, integer) from public, anon, authenticated;
grant execute on function public.hybrid_search(text, vector, integer) to service_role;
