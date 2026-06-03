-- ═══════════════════════════════════════════════════════════════════════════════
-- Ειδήμονας — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Extensions ──────────────────────────────────────────────────────────────
-- uuid_generate_v4() is used as default ID generator
create extension if not exists "uuid-ossp";

-- ─── Table: documents ────────────────────────────────────────────────────────
-- Stores metadata for every uploaded document. One row per upload.
create table if not exists public.documents (
  id                uuid        primary key default uuid_generate_v4(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  filename          text        not null,
  file_path         text,                          -- reserved / unused currently
  vector_store_path text,                          -- supabase://vector-stores/{id}/index.zip
  file_data         text,                          -- base64 backup of original file (for cold-start rebuild)
  created_at        timestamptz not null default now()
);

-- Index to speed up per-user document listing (ORDER BY created_at)
create index if not exists idx_documents_user_created
  on public.documents (user_id, created_at desc);

-- ─── Table: chat_messages ─────────────────────────────────────────────────────
-- Stores every chat turn for every document session.
create table if not exists public.chat_messages (
  id          uuid        primary key default uuid_generate_v4(),
  document_id uuid        not null references public.documents(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  role        text        not null check (role in ('user', 'assistant')),
  content     text        not null,
  sources     jsonb       not null default '[]',   -- array of {content, page, source}
  created_at  timestamptz not null default now()
);

-- Index to speed up conversation history lookup per document
create index if not exists idx_chat_messages_document_created
  on public.chat_messages (document_id, created_at asc);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- RLS ensures every user can only see and modify their own data.
-- IMPORTANT: Without these policies, all data would be visible to all users.

alter table public.documents    enable row level security;
alter table public.chat_messages enable row level security;

-- documents: users can only read their own documents
create policy "Users can read own documents"
  on public.documents for select
  using (auth.uid() = user_id);

-- documents: users can only insert their own documents
create policy "Users can insert own documents"
  on public.documents for insert
  with check (auth.uid() = user_id);

-- documents: users can only update their own documents
create policy "Users can update own documents"
  on public.documents for update
  using (auth.uid() = user_id);

-- documents: users can only delete their own documents
create policy "Users can delete own documents"
  on public.documents for delete
  using (auth.uid() = user_id);

-- chat_messages: users can only read their own messages
create policy "Users can read own chat messages"
  on public.chat_messages for select
  using (auth.uid() = user_id);

-- chat_messages: users can only insert their own messages
create policy "Users can insert own chat messages"
  on public.chat_messages for insert
  with check (auth.uid() = user_id);

-- chat_messages: no update/delete on messages (immutable history)

-- ─── Optional: statement timeout for large file recovery ─────────────────────
-- Increase query timeout so large base64 file_data rows can be fetched
-- without hitting the default PostgREST statement timeout.
-- Uncomment and run separately in the SQL Editor if needed:
--
-- alter role authenticator set statement_timeout = '60s';
-- alter role anon       set statement_timeout = '60s';
-- alter role authenticated set statement_timeout = '60s';

-- ─── Database Grants ──────────────────────────────────────────────────────────
-- Explicitly grant table privileges to Supabase authenticated and service_role roles.
-- This prevents "permission denied" errors after recreating tables.

grant select, insert, update, delete on table public.documents to authenticated, service_role;
grant select, insert, update, delete on table public.chat_messages to authenticated, service_role;

-- ─── Supabase Storage Bucket ──────────────────────────────────────────────────
-- The backend creates this bucket automatically on first upload.
-- You can also create it manually:
--   Supabase Dashboard → Storage → New Bucket
--   Name: vector-stores
--   Public: OFF (private)
--
-- Storage access is controlled by the backend service-role key,
-- not by client-side RLS policies.

