import { createClient } from '@supabase/supabase-js';
import { authenticateUser } from './auth-guard.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  const user = await authenticateUser(req, res);
  if (!user) return;

  const email = user.email.toLowerCase();
  const roll_number = email.split('@')[0].toUpperCase();
  const name = user.user_metadata?.full_name || roll_number;

  if (req.method === 'GET') {
    // 1. Get or Create Student Record
    let { data: student } = await supabase.from('students').select('*').eq('email', email).maybeSingle();
    
    if (!student) {
      const { data: newStudent, error } = await supabase.from('students')
        .insert({ email, roll_number, name })
        .select().single();
      if (error) return res.status(500).json({ error: error.message });
      student = newStudent;
    }

    // 2. Fetch Enrolled Courses
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('courses(id, course_code, course_name)')
      .eq('student_id', student.id);

    const courses = (enrollments || []).map(e => e.courses);
    
    return res.status(200).json({
      student: { name: student.name, roll_number: student.roll_number, is_registered: !!student.webauthn_credential },
      courses
    });
  }

  if (req.method === 'POST') {
    const { course_code } = req.body;
    if (!course_code) return res.status(400).json({ error: 'Course code required' });

    const { data: course } = await supabase.from('courses').select('id').ilike('course_code', course_code).maybeSingle();
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const { data: student } = await supabase.from('students').select('id').eq('email', email).single();
    
    const { error } = await supabase.from('enrollments').insert({ student_id: student.id, course_id: course.id });
    if (error && error.code !== '23505') return res.status(500).json({ error: error.message }); // Ignore duplicates

    return res.status(200).json({ success: true });
  }

  res.status(405).end();
}