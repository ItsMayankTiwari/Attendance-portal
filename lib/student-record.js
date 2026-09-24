import { createClient } from '@supabase/supabase-js';
import { authenticateUser } from './auth-guard.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;

  const email = user.email.toLowerCase();
  const { data: student } = await supabase.from('students').select('id').eq('email', email).single();

  // 1. Get enrolled courses
  const { data: enrollments } = await supabase.from('enrollments')
    .select('course_id, courses(course_code, course_name)')
    .eq('student_id', student.id);
    
  const courseIds = enrollments.map(e => e.course_id);
  if (courseIds.length === 0) return res.status(200).json([]);

  // 2. Get all sessions for these courses
  const { data: sessions } = await supabase.from('sessions')
    .select('id, course_id, session_date')
    .in('course_id', courseIds);

  // 3. Get student's attendance records
  const { data: attendance } = await supabase.from('attendance_records')
    .select('session_id')
    .eq('student_id', student.id);
    
  const attendedSessionIds = new Set(attendance.map(a => a.session_id));

  // 4. Calculate stats per course
  const stats = enrollments.map(e => {
    const courseSessions = sessions.filter(s => s.course_id === e.course_id);
    const attendedSessions = courseSessions.filter(s => attendedSessionIds.has(s.id));
    
    return {
      course_code: e.courses.course_code,
      course_name: e.courses.course_name,
      total_classes: courseSessions.length,
      attended_classes: attendedSessions.length,
      percentage: courseSessions.length > 0 ? Math.round((attendedSessions.length / courseSessions.length) * 100) : 0,
      dates_present: attendedSessions.map(s => s.session_date).sort((a, b) => new Date(b) - new Date(a))
    };
  });

  res.status(200).json(stats);
}