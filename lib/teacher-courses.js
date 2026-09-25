import { authenticateTeacher, verifyCourseAccess, supabase } from './teacher-guard.js';

// Course-project scale: while there is one professor and TAs are added later,
// who may create a course is controlled by an env var rather than a table.
// Set AUTHORIZED_PROFESSOR_EMAILS to a comma-separated list in Vercel —
// never hardcode an address in source that sits in a public repo.
const AUTHORIZED_PROFESSORS = (process.env.AUTHORIZED_PROFESSOR_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

export default async function handler(req, res) {
  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const email = user.email.toLowerCase();

  if (req.method === 'GET') {
    const { data: instructedCourses } = await supabase
      .from('courses').select('*').ilike('instructor_email', email);

    const { data: taAssignments } = await supabase
      .from('course_staff').select('course_id, role, courses(*)').ilike('email', email);

    const taCourses = (taAssignments || []).map(a => ({ ...a.courses, user_role: a.role }));
    const ownCourses = (instructedCourses || []).map(c => ({ ...c, user_role: 'INSTRUCTOR' }));

    const courseMap = new Map();
    [...ownCourses, ...taCourses].forEach(c => { if (c && c.id) courseMap.set(c.id, c); });

    return res.status(200).json(Array.from(courseMap.values()));
  }

  if (req.method === 'POST') {
    const { action } = req.body;

    if (action === 'create_course') {
      if (!AUTHORIZED_PROFESSORS.includes(email)) {
        return res.status(403).json({ error: 'Only the authorized professor can create new courses.' });
      }

      const { course_code, course_name } = req.body;
      if (!course_code || !course_name) {
        return res.status(400).json({ error: 'course_code and course_name are required.' });
      }

      const { data, error } = await supabase
        .from('courses')
        .insert({ course_code: course_code.trim().toUpperCase(), course_name: course_name.trim(), instructor_email: email })
        .select().single();

      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'That course code is already in use.' });
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json(data);
    }

    if (action === 'delete_course') {
      const { course_id } = req.body;
      if (!course_id) return res.status(400).json({ error: 'course_id is required.' });

      const { authorized, role } = await verifyCourseAccess(email, course_id);
      if (!authorized || role !== 'INSTRUCTOR') {
        return res.status(403).json({ error: 'Only the course instructor can delete this course.' });
      }

      const { error } = await supabase.from('courses').delete().eq('id', course_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'add_ta') {
      const { course_id, ta_email } = req.body;
      if (!course_id || !ta_email) {
        return res.status(400).json({ error: 'course_id and ta_email are required.' });
      }

      const { authorized, role } = await verifyCourseAccess(email, course_id);
      if (!authorized || role !== 'INSTRUCTOR') {
        return res.status(403).json({ error: 'Only the course instructor can add TAs.' });
      }

      const { data, error } = await supabase
        .from('course_staff')
        .insert({ course_id, email: ta_email.trim().toLowerCase(), role: 'TA' })
        .select().single();

      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'TA is already added.' });
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Invalid action.' });
  }

  return res.status(405).end();
}
