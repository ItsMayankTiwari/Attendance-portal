import { authenticateUser, supabase } from './auth-guard.js';

export const authenticateTeacher = authenticateUser;
export { supabase };

export async function verifyCourseAccess(email, courseId) {
  const e = String(email || '').trim().toLowerCase();

  const { data: course } = await supabase.from('courses').select('id')
    .eq('id', courseId).eq('instructor_email', e).maybeSingle();
  if (course) return { authorized: true, role: 'INSTRUCTOR' };

  const { data: staff } = await supabase.from('course_staff').select('role')
    .eq('course_id', courseId).eq('email', e).maybeSingle();
  if (staff) return { authorized: true, role: staff.role };

  return { authorized: false };
}

export async function courseIdForSession(sessionId) {
  const { data } = await supabase.from('sessions').select('course_id').eq('id', sessionId).maybeSingle();
  return data ? data.course_id : null;
}
