-- Run this in the Supabase SQL editor against your EXISTING project.
-- Every statement is guarded (if not exists / add column if not exists) so
-- it will not touch data that's already there — safe to run as-is.

alter table students add column if not exists email text;
alter table students add column if not exists current_challenge text;
-- If this next line errors with a null-value/unique-violation, some
-- students don't have an email yet — backfill first, e.g.:
--   update students set email = lower(roll_number) || '@iitj.ac.in' where email is null;
create unique index if not exists students_email_key on students(email);

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

alter table sessions add column if not exists course_id uuid references courses(id) on delete cascade;
alter table sessions add column if not exists is_active boolean default true;
alter table sessions add column if not exists created_by text;
alter table sessions add column if not exists session_secret text;

create index if not exists idx_enrollments_student on enrollments(student_id);
create index if not exists idx_enrollments_course on enrollments(course_id);
create index if not exists idx_sessions_course on sessions(course_id);
create index if not exists idx_attendance_session on attendance_records(session_id);
create index if not exists idx_attendance_student on attendance_records(student_id);

alter table students enable row level security;
alter table courses enable row level security;
alter table course_staff enable row level security;
alter table enrollments enable row level security;
alter table sessions enable row level security;
alter table attendance_records enable row level security;

-- Optional cleanup once you've confirmed nothing else reads it — the
-- edit-profile flow no longer uses a separate challenges table:
-- drop table if exists auth_challenges;
