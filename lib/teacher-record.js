import { createClient } from '@supabase/supabase-js';
import { authenticateTeacher, verifyCourseAccess } from './teacher-guard.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const course_id = req.query.course_id;
  if (!course_id) return res.status(400).json({ error: 'course_id is required' });

  // 1. Verify access
  const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), course_id);
  if (!authorized) return res.status(403).json({ error: 'Not authorized to view this course.' });

  // 2. Fetch enrolled students
  const { data: enrollments } = await supabase.from('enrollments')
    .select('student_id, students(roll_number, name)')
    .eq('course_id', course_id);
    
  // 3. Fetch all sessions for the course
  const { data: sessions } = await supabase.from('sessions')
    .select('id, session_date')
    .eq('course_id', course_id);
    
  const sessionIds = sessions.map(s => s.id);
  
  // 4. Fetch attendance records for those sessions
  let attendance = [];
  if (sessionIds.length > 0) {
    const { data } = await supabase.from('attendance_records')
      .select('student_id, session_id')
      .in('session_id', sessionIds);
    attendance = data || [];
  }

  // 5. Calculate stats per student
  const stats = enrollments.map(e => {
    const studentAttendance = attendance.filter(a => a.student_id === e.student_id);
    const attendedSessionIds = new Set(studentAttendance.map(a => a.session_id));
    const attendedSessions = sessions.filter(s => attendedSessionIds.has(s.id));

    return {
      roll_number: e.students.roll_number,
      name: e.students.name,
      total_classes: sessions.length,
      attended_classes: attendedSessions.length,
      percentage: sessions.length > 0 ? Math.round((attendedSessions.length / sessions.length) * 100) : 0,
      dates_present: attendedSessions.map(s => s.session_date).sort((a, b) => new Date(b) - new Date(a))
    };
  });

  // Sort alphabetically by Roll Number
  stats.sort((a, b) => a.roll_number.localeCompare(b.roll_number));

  res.status(200).json({ total_sessions: sessions.length, stats });
}