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

-- Weekly domain classifications produced by daemon/orchestrator.py.
-- The orchestrator upserts on (event_id, week_start), so the UNIQUE constraint
-- below makes re-running a given week idempotent (one row per paper per week).
create table if not exists public.paper_classifications (
    id          bigint generated always as identity primary key,
    event_id    bigint      not null,
    student_id  text,
    domains     jsonb       not null default '[]'::jsonb,
    confidence  numeric,
    note        text,
    week_start  date        not null,
    created_at  timestamptz not null default now(),
    unique (event_id, week_start)
);

create index if not exists paper_classifications_student_week_idx
    on public.paper_classifications (student_id, week_start);

-- Weekly narrative progress reports produced by daemon/report.py. Each run
-- inserts a fresh row; `share_token` is a per-report secret for shareable links.
create table if not exists public.weekly_reports (
    id                 bigint generated always as identity primary key,
    student_id         text,
    week_start         date        not null,
    narrative          text,
    paper_count        integer,
    coding_hours       numeric,
    writing_activities jsonb       not null default '[]'::jsonb,
    share_token        text        not null unique,
    created_at         timestamptz not null default now()
);

create index if not exists weekly_reports_student_week_idx
    on public.weekly_reports (student_id, week_start);
