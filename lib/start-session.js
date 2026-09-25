import crypto from 'crypto';
import { authenticateTeacher, verifyCourseAccess, supabase } from './teacher-guard.js';

const ROTATION_SECONDS = 6;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const { course_id } = req.body;
  if (!course_id) return res.status(400).json({ error: 'course_id is required.' });

  const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), course_id);
  if (!authorized) return res.status(403).json({ error: 'You are not authorized for this course.' });

  // A fresh random secret per session (never sent to students) means the QR
  // shown for one lecture can't be reverse-engineered to forge another.
  const session_secret = crypto.randomBytes(24).toString('hex');

  const { data, error } = await supabase
    .from('sessions')
    .insert({ course_id, created_by: user.email.toLowerCase(), is_active: true, session_secret })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });

  // The secret is only ever handed to the authenticated teacher who just
  // started this exact session — it is never stored client-side or logged.
  res.status(200).json({ session_id: data.id, session_secret, rotation_seconds: ROTATION_SECONDS });
}
