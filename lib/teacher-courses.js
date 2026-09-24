import { createClient } from '@supabase/supabase-js';
import { authenticateTeacher, verifyCourseAccess } from './teacher-guard.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const email = user.email.toLowerCase();

  // GET: Fetch all courses where the user is an Instructor or TA
  if (req.method === 'GET') {
    const { data: instructedCourses } = await supabase
      .from('courses')
      .select('*')
      .ilike('instructor_email', email);

    const { data: taAssignments } = await supabase
      .from('course_staff')
      .select('course_id, role, courses(*)')
      .ilike('email', email);

    const taCourses = (taAssignments || []).map(a => ({ ...a.courses, user_role: a.role }));
    const ownCourses = (instructedCourses || []).map(c => ({ ...c, user_role: 'INSTRUCTOR' }));

    // Deduplicate by course ID
    const courseMap = new Map();
    [...ownCourses, ...taCourses].forEach(c => {
      if (c && c.id) courseMap.set(c.id, c);
    });

    return res.status(200).json(Array.from(courseMap.values()));
  }

  // POST: Create Course or Add TA
  if (req.method === 'POST') {
    const { action } = req.body;

    if (action === 'create_course') {
      const AUTHORIZED_PROFESSOR = 'b25cm1075@iitj.ac.in'; 
      
      if (email !== AUTHORIZED_PROFESSOR) {
        return res.status(403).json({ error: 'Only the authorized professor can create new courses.' });
      }

      const { course_code, course_name } = req.body;
      if (!course_code || !course_name) {
        return res.status(400).json({ error: 'course_code and course_name are required.' });
      }

      const { data, error } = await supabase
        .from('courses')
        .insert({
          course_code: course_code.trim().toUpperCase(),
          course_name: course_name.trim(),
          instructor_email: email
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    }

    if (action === 'add_ta') {
      const { course_id, ta_email } = req.body;
      if (!course_id || !ta_email) {
        return res.status(400).json({ error: 'course_id and ta_email are required.' });
      }

      // Only the primary instructor can add a TA
      const { authorized, role } = await verifyCourseAccess(email, course_id);
      if (!authorized || role !== 'INSTRUCTOR') {
        return res.status(403).json({ error: 'Only the course instructor can add TAs.' });
      }

      const { data, error } = await supabase
        .from('course_staff')
        .insert({
          course_id,
          email: ta_email.trim().toLowerCase(),
          role: 'TA'
        })
        .select()
        .single();

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