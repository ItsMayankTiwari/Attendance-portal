import { authenticateTeacher, verifyCourseAccess, courseIdForSession, supabase } from './teacher-guard.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id is required.' });

  const course_id = await courseIdForSession(session_id);
  if (!course_id) return res.status(404).json({ error: 'Session not found.' });

  const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), course_id);
  if (!authorized) return res.status(403).json({ error: 'Not authorized for this session.' });

  const { error } = await supabase.from('sessions').update({ is_active: false }).eq('id', session_id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ success: true });
}
