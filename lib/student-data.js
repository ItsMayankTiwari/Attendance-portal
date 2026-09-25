import { authenticateUser, supabase } from './auth-guard.js';

export default async function handler(req, res) {
  const user = await authenticateUser(req, res);
  if (!user) return;

  const email = user.email.toLowerCase();
  const roll_number = email.split('@')[0].toUpperCase();
  const name = user.user_metadata?.full_name || roll_number;

  if (req.method === 'GET') {
    let { data: student } = await supabase.from('students').select('*').eq('email', email).maybeSingle();

    if (!student) {
      const { data: newStudent, error } = await supabase.from('students')
        .insert({ email, roll_number, name })
        .select().single();
      if (error) return res.status(500).json({ error: error.message });
      student = newStudent;
    }

    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('courses(id, course_code, course_name)')
      .eq('student_id', student.id);

    const courses = (enrollments || []).map(e => e.courses).filter(Boolean);

    return res.status(200).json({
      student: {
        name: student.name,
        roll_number: student.roll_number,
        email: student.email,
        is_registered: !!student.webauthn_credential
      },
      courses
    });
  }

  if (req.method === 'POST') {
    const { course_code } = req.body;
    if (!course_code) return res.status(400).json({ error: 'Course code required.' });

    const { data: course } = await supabase.from('courses').select('id').ilike('course_code', course_code.trim()).maybeSingle();
    if (!course) return res.status(404).json({ error: 'No course with that code.' });

    const { data: student } = await supabase.from('students').select('id').eq('email', email).single();

    const { error } = await supabase.from('enrollments').insert({ student_id: student.id, course_id: course.id });
    if (error && error.code !== '23505') return res.status(500).json({ error: error.message });

    return res.status(200).json({ success: true });
  }

  res.status(405).end();
}
