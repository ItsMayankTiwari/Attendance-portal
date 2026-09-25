import { authenticateTeacher, verifyCourseAccess, supabase } from './teacher-guard.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const course_id = req.query.course_id;
  if (!course_id) return res.status(400).json({ error: 'course_id is required.' });

  const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), course_id);
  if (!authorized) return res.status(403).json({ error: 'Not authorized to view this course.' });

  const { data: enrollments } = await supabase.from('enrollments')
    .select('student_id, students(roll_number, name)')
    .eq('course_id', course_id);

  const { data: sessions } = await supabase.from('sessions')
    .select('id, session_date')
    .eq('course_id', course_id)
    .order('session_date', { ascending: true });

  const sessionIds = (sessions || []).map(s => s.id);

  let attendance = [];
  if (sessionIds.length > 0) {
    const { data } = await supabase.from('attendance_records')
      .select('student_id, session_id')
      .in('session_id', sessionIds);
    attendance = data || [];
  }

  const stats = (enrollments || []).map(e => {
    const mine = attendance.filter(a => a.student_id === e.student_id).map(a => a.session_id);
    const attendedCount = mine.length;
    const total = (sessions || []).length;

    return {
      student_id: e.student_id,
      roll_number: e.students.roll_number,
      name: e.students.name,
      total_classes: total,
      attended_classes: attendedCount,
      percentage: total > 0 ? Math.round((attendedCount / total) * 100) : 0,
      present_session_ids: mine
    };
  });

  stats.sort((a, b) => a.roll_number.localeCompare(b.roll_number));

  res.status(200).json({
    total_sessions: (sessions || []).length,
    sessions: sessions || [],
    stats
  });
}
