import { createClient } from '@supabase/supabase-js';
import { authenticateTeacher, verifyCourseAccess } from './teacher-guard.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const { course_id } = req.body;
  if (!course_id) return res.status(400).json({ error: 'course_id is required.' });

  const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), course_id);
  if (!authorized) {
    return res.status(403).json({ error: 'You are not authorized for this course.' });
  }

  const { data: course } = await supabase.from('courses').select('course_code').eq('id', course_id).single();

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      course_id,
      course_code: course ? course.course_code : null,
      created_by: user.email.toLowerCase(),
      is_active: true
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ session_id: data.id });
}