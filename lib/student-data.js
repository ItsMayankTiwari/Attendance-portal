import { authenticateUser, supabase } from './auth-guard.js';

export default async function handler(req, res) {
  const user = await authenticateUser(req, res);
  if (!user) return;

  const email = user.email.toLowerCase();
  const roll_number = email.split('@')[0].toUpperCase();
  const name = String(user.user_metadata?.full_name || roll_number).slice(0, 80);

  if (req.method === 'GET') {
    let { data: student } = await supabase.from('students').select('*').eq('email', email).maybeSingle();

    if (!student) {
      const { data: created, error } = await supabase.from('students')
        .insert({ email, roll_number, name }).select().single();
      if (error && error.code === '23505') {
        const retry = await supabase.from('students').select('*').eq('email', email).maybeSingle();
        student = retry.data;
        if (!student) return res.status(409).json({ error: 'This roll number is linked to another account. Contact your instructor.' });
      } else if (error) {
        return res.status(500).json({ error: 'Could not create your account.' });
      } else {
        student = created;
      }
    }

    const { data: enrollments } = await supabase.from('enrollments')
      .select('courses(id, course_code, course_name)').eq('student_id', student.id);
    const courses = (enrollments || []).map(e => e.courses).filter(Boolean);

    return res.status(200).json({
      student: { name: student.name, roll_number: student.roll_number, email: student.email, is_registered: !!student.webauthn_credential },
      courses
    });
  }

  if (req.method === 'POST') {
    const code = String((req.body || {}).course_code || '').trim().toUpperCase();
    if (!code || code.length > 30) return res.status(400).json({ error: 'Course code required.' });

    const { data: course } = await supabase.from('courses').select('id').eq('course_code', code).maybeSingle();
    if (!course) return res.status(404).json({ error: 'No course with that code.' });

    const { data: student } = await supabase.from('students').select('id').eq('email', email).single();
    const { error } = await supabase.from('enrollments').insert({ student_id: student.id, course_id: course.id });
    if (error && error.code !== '23505') return res.status(500).json({ error: 'Could not add the course.' });

    return res.status(200).json({ success: true });
  }

  res.status(405).end();
}
