import { authenticateTeacher, verifyCourseAccess, courseIdForSession, supabase } from './teacher-guard.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id.' });

  const course_id = await courseIdForSession(session_id);
  if (!course_id) return res.status(404).json({ error: 'Session not found.' });

  const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), course_id);
  if (!authorized) return res.status(403).json({ error: 'Not authorized for this session.' });

  const { data, error } = await supabase
    .from('attendance_records')
    .select(`marked_at, students ( roll_number, name )`)
    .eq('session_id', session_id)
    .order('marked_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
}
