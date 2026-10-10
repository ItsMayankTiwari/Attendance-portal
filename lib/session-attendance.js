import { authenticateTeacher, verifyCourseAccess, supabase } from './teacher-guard.js';
import { sessionIsLive } from './config.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const { session_id, locations } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id.' });

  const { data: sess } = await supabase.from('sessions')
    .select('course_id, is_active, session_date').eq('id', session_id).maybeSingle();
  if (!sess) return res.status(404).json({ error: 'Session not found.' });

  const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), sess.course_id);
  if (!authorized) return res.status(403).json({ error: 'Not authorized for this session.' });

  // GPS / IP are only ever released after the session has ended.
  const wantLocations = locations === '1';
  if (wantLocations && sessionIsLive(sess)) {
    return res.status(409).json({ error: 'Locations are available once the session has ended.' });
  }

  const columns = wantLocations
    ? 'marked_at, latitude, longitude, device_ip, students ( roll_number )'
    : 'marked_at, students ( roll_number )'; // live polling: count only, smaller payload

  const { data, error } = await supabase
    .from('attendance_records')
    .select(columns)
    .eq('session_id', session_id)
    .order('marked_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
}
