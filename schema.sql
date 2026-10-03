-- Fresh-install schema. If you already have a live project, use
-- migration.sql instead — it upgrades your existing tables in place.

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  roll_number text unique not null,
  name text not null,
  webauthn_credential jsonb,
  current_challenge text,
  created_at timestamptz default now()
);

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  course_code text unique not null,
  course_name text not null,
  instructor_email text not null,
  created_at timestamptz default now()
);

create table if not exists course_staff (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade,
  email text not null,
  role text not null default 'TA',
  created_at timestamptz default now(),
  unique(course_id, email)
);

create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  course_id uuid references courses(id) on delete cascade,
  created_at timestamptz default now(),
  unique(student_id, course_id)
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade,
  session_date timestamptz default now(),
  is_active boolean default true,
  created_by text,
  session_secret text
);

create table if not exists attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  session_id uuid references sessions(id) on delete cascade,
  marked_at timestamptz default now(),
  unique(student_id, session_id)
);

create index if not exists idx_enrollments_student on enrollments(student_id);
create index if not exists idx_enrollments_course on enrollments(course_id);
create index if not exists idx_sessions_course on sessions(course_id);
create index if not exists idx_attendance_session on attendance_records(session_id);
create index if not exists idx_attendance_student on attendance_records(student_id);

-- The anon key ships inside the public JS bundle (that's normal for
-- Supabase) — RLS with zero policies is what actually stops someone
-- copying that key out of GitHub and querying these tables directly from
-- a browser console. Every real read/write goes through the API routes
-- using the service-role key, which bypasses RLS entirely.
alter table students enable row level security;
alter table courses enable row level security;
alter table course_staff enable row level security;
alter table enrollments enable row level security;
alter table sessions enable row level security;
alter table attendance_records enable row level security;

-- Explicitly RESTRICTIVE policies (Defense in depth)
-- We enforce that no one can read or write directly from the frontend using the anon/authenticated key.
-- All operations MUST go through the Vercel API routes which use the Service Role key.
create policy "Deny all reads" on students as restrictive for select using (false);
create policy "Deny all writes" on students as restrictive for all using (false);
create policy "Deny all reads" on courses as restrictive for select using (false);
create policy "Deny all writes" on courses as restrictive for all using (false);
create policy "Deny all reads" on course_staff as restrictive for select using (false);
create policy "Deny all writes" on course_staff as restrictive for all using (false);
create policy "Deny all reads" on enrollments as restrictive for select using (false);
create policy "Deny all writes" on enrollments as restrictive for all using (false);
create policy "Deny all reads" on sessions as restrictive for select using (false);
create policy "Deny all writes" on sessions as restrictive for all using (false);
create policy "Deny all reads" on attendance_records as restrictive for select using (false);
create policy "Deny all writes" on attendance_records as restrictive for all using (false);
