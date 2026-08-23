create table students (
  id uuid primary key default gen_random_uuid(),
  roll_number text unique not null,
  name text not null,
  webauthn_credential jsonb,
  created_at timestamptz default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  course_code text,
  session_date timestamptz default now()
);

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id),
  session_id uuid references sessions(id),
  marked_at timestamptz default now(),
  unique(student_id, session_id)
);