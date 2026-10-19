import { authenticateTeacher, verifyCourseAccess, supabase } from './teacher-guard.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const { course_id, roll_number } = req.body || {};
  if (!course_id || !roll_number) {
    return res.status(400).json({ error: 'course_id and roll_number are required.' });
  }

  const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), course_id);
  if (!authorized) return res.status(403).json({ error: 'Not authorized for this course.' });

  const cleanRoll = String(roll_number).trim().toUpperCase();
  const { data: student } = await supabase
    .from('students')
    .select('id, name, roll_number')
    .eq('roll_number', cleanRoll)
    .maybeSingle();

  if (!student) return res.status(404).json({ error: 'No student found with that roll number.' });

  // Verify the student is enrolled in this course
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id')
    .eq('student_id', student.id)
    .eq('course_id', course_id)
    .maybeSingle();

  if (!enrollment) {
    return res.status(403).json({ error: `${student.name} is not enrolled in this course.` });
  }

  // Remove the bound device credentials for this student (unbinding the device)
  const { error: resetErr } = await supabase
    .from('students')
    .update({
      webauthn_credential: null,
      current_challenge: null,
      challenge_purpose: null,
      challenge_expires_at: null
    })
    .eq('id', student.id);

  if (resetErr) return res.status(500).json({ error: resetErr.message });

  res.status(200).json({ success: true, roll_number: student.roll_number, name: student.name });
}
