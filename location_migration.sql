-- Run this in your Supabase SQL editor to add the columns required by the TA
alter table attendance_records add column if not exists latitude double precision;
alter table attendance_records add column if not exists longitude double precision;
alter table attendance_records add column if not exists device_ip text;
