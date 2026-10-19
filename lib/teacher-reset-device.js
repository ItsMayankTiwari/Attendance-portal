import { authenticateTeacher, verifyCourseAccess, supabase } from './teacher-guard.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateTeacher(req, res);
  if (!user) return;

  const { course_id, roll_number } = req.body || {};
  if (!roll_number) {
    return res.status(400).json({ error: 'roll_number is required.' });
  }

  const cleanRoll = String(roll_number).trim().toUpperCase();
  const { data: student } = await supabase
    .from('students')
    .select('id, name, roll_number')
    .eq('roll_number', cleanRoll)
    .maybeSingle();

  if (!student) return res.status(404).json({ error: `No student found with roll number "${cleanRoll}".` });

  const teacherEmail = user.email.toLowerCase();

  if (course_id) {
    const { authorized } = await verifyCourseAccess(teacherEmail, course_id);
    if (!authorized) return res.status(403).json({ error: 'Not authorized for this course.' });

    // Verify the student is enrolled in this course
    const { data: enrollment } = await supabase
      .from('enrollments')
      .select('id')
      .eq('student_id', student.id)
      .eq('course_id', course_id)
      .maybeSingle();

    if (!enrollment) {
      return res.status(403).json({ error: `${student.name} (${cleanRoll}) is not enrolled in this course.` });
    }
  } else {
    // If no course_id specified, check if student is in any course taught or TA-ed by this teacher
    const { data: myCourses } = await supabase
      .from('courses')
      .select('id')
      .eq('instructor_email', teacherEmail);

    const { data: myTaCourses } = await supabase
      .from('course_staff')
      .select('course_id')
      .eq('email', teacherEmail);

    const allowedCourseIds = [
      ...(myCourses || []).map(c => c.id),
      ...(myTaCourses || []).map(c => c.course_id)
    ];

    if (allowedCourseIds.length === 0) {
      return res.status(403).json({ error: 'You do not have any active courses.' });
    }

    const { data: enrollment } = await supabase
      .from('enrollments')
      .select('id')
      .eq('student_id', student.id)
      .in('course_id', allowedCourseIds)
      .limit(1);

    if (!enrollment || enrollment.length === 0) {
      return res.status(403).json({ error: `${student.name} (${cleanRoll}) is not enrolled in any of your courses.` });
    }
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
