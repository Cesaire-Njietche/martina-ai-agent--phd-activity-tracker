-- Schema for the martina daemon. Run in the Supabase SQL editor.
--
-- The daemon upserts on `dedup_hash`, so the UNIQUE constraint below is what
-- enforces "one row per (student, paper/app, day)" across daemon restarts.

create table if not exists public.unified_events (
    id            bigint generated always as identity primary key,
    student_id    text,
    source        text        not null,
    activity_type text,
    "timestamp"   timestamptz not null,
    engaged_secs  numeric     not null default 0,
    metadata      jsonb       not null default '{}'::jsonb,
    dedup_hash    text        not null unique,
    created_at    timestamptz not null default now()
);

create index if not exists unified_events_student_day_idx
    on public.unified_events (student_id, "timestamp");
