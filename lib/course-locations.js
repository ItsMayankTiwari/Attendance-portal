import { authenticateTeacher, verifyCourseAccess, supabase } from './teacher-guard.js';
import { sessionIsLive } from './config.js';

const PAGE = 1000;       // Supabase returns at most 1000 rows per request
const MAX_ROWS = 20000;  // safety cap

// One request returns every scan from each finished lecture of a course.
// Lectures that are still live are excluded on the server.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const { course_id } = req.query;
  if (!course_id) return res.status(400).json({ error: 'Missing course_id.' });

  const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), course_id);
  if (!authorized) return res.status(403).json({ error: 'Not authorized for this course.' });

  const { data: sess, error: sErr } = await supabase
    .from('sessions')
    .select('id, session_date, is_active')
    .eq('course_id', course_id)
    .order('session_date', { ascending: true });
  if (sErr) return res.status(500).json({ error: sErr.message });

  const ended = (sess || []).filter(s => !sessionIsLive(s));
  if (!ended.length) return res.status(200).json({ sessions: [], points: [], truncated: false });

  const idx = new Map(ended.map((s, i) => [s.id, i]));
  const points = []; // compact rows: [sessionIndex, lat, lng, rollNumber, ip]
  let truncated = false;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('session_id, latitude, longitude, device_ip, students ( roll_number ), sessions!inner ( course_id )')
      .eq('sessions.course_id', course_id)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return res.status(500).json({ error: error.message });

    for (const r of data) {
      const i = idx.get(r.session_id);
      if (i === undefined) continue; // belongs to a live session
      points.push([i, r.latitude, r.longitude, r.students ? r.students.roll_number : '', r.device_ip]);
    }
    if (data.length < PAGE) break;
    if (from + PAGE >= MAX_ROWS) { truncated = true; break; }
  }

  res.status(200).json({
    sessions: ended.map(s => ({ id: s.id, date: s.session_date })),
    points,
    truncated
  });
}
