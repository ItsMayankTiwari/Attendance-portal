import { authenticateUser, supabase } from './auth-guard.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;

  const email = user.email.toLowerCase();
  const { data: student } = await supabase.from('students').select('id').eq('email', email).single();

  const { data: enrollments } = await supabase.from('enrollments')
    .select('course_id, courses(id, course_code, course_name)')
    .eq('student_id', student.id);

  if (!enrollments || enrollments.length === 0) return res.status(200).json([]);

  const courseIds = enrollments.map(e => e.course_id);

  const { data: sessions } = await supabase.from('sessions')
    .select('id, course_id, session_date')
    .in('course_id', courseIds);

  const { data: attendance } = await supabase.from('attendance_records')
    .select('session_id')
    .eq('student_id', student.id);

  const attendedSessionIds = new Set((attendance || []).map(a => a.session_id));

  const stats = enrollments.map(e => {
    const courseSessions = (sessions || [])
      .filter(s => s.course_id === e.course_id)
      .sort((a, b) => new Date(b.session_date) - new Date(a.session_date));
    const attendedCount = courseSessions.filter(s => attendedSessionIds.has(s.id)).length;

    return {
      course_id: e.course_id,
      course_code: e.courses.course_code,
      course_name: e.courses.course_name,
      total_classes: courseSessions.length,
      attended_classes: attendedCount,
      percentage: courseSessions.length > 0 ? Math.round((attendedCount / courseSessions.length) * 100) : 0,
      lectures: courseSessions.map(s => ({
        session_id: s.id,
        date: s.session_date,
        present: attendedSessionIds.has(s.id)
      }))
    };
  });

  res.status(200).json(stats);
}
