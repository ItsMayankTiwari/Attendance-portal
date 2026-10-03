import crypto from 'crypto';
import { authenticateTeacher, verifyCourseAccess, supabase } from './teacher-guard.js';
import { ROTATION_SECONDS, SESSION_MAX_MS } from './config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const { course_id } = req.body || {};
  if (!course_id) return res.status(400).json({ error: 'course_id is required.' });

  const email = user.email.toLowerCase();
  const { authorized } = await verifyCourseAccess(email, course_id);
  if (!authorized) return res.status(403).json({ error: 'You are not authorized for this course.' });

  const since = new Date(Date.now() - SESSION_MAX_MS).toISOString();

  const { data: running } = await supabase.from('sessions').select('id')
    .eq('course_id', course_id).eq('is_active', true).gte('session_date', since)
    .order('session_date', { ascending: false }).limit(1).maybeSingle();
  if (running) return res.status(200).json({ session_id: running.id, rotation_seconds: ROTATION_SECONDS, resumed: true });

  await supabase.from('sessions').update({ is_active: false })
    .eq('course_id', course_id).eq('is_active', true).lt('session_date', since);

  const session_secret = crypto.randomBytes(32).toString('hex');
  const { data, error } = await supabase.from('sessions')
    .insert({ course_id, created_by: email, is_active: true, session_secret }).select('id').single();
  if (error) return res.status(500).json({ error: 'Could not start the session.' });

  res.status(200).json({ session_id: data.id, rotation_seconds: ROTATION_SECONDS });
}
