import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const INSTITUTE_DOMAIN = (process.env.INSTITUTE_DOMAIN || 'iitj.ac.in').toLowerCase();

/**
 * Validates the Supabase Auth access token from the Authorization header
 * and that it belongs to the institute domain. Returns the user object, or
 * sends a 401/403 response and returns null.
 */
export async function authenticateTeacher(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header.' });
    return null;
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user || !user.email) {
    res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    return null;
  }

  if (!user.email.toLowerCase().endsWith('@' + INSTITUTE_DOMAIN)) {
    res.status(403).json({ error: `Please sign in with your @${INSTITUTE_DOMAIN} account.` });
    return null;
  }

  return user;
}

/**
 * Checks whether the email is the course instructor or an assigned TA.
 */
export async function verifyCourseAccess(email, courseId) {
  const { data: course } = await supabase
    .from('courses')
    .select('id')
    .eq('id', courseId)
    .ilike('instructor_email', email)
    .maybeSingle();

  if (course) return { authorized: true, role: 'INSTRUCTOR' };

  const { data: staff } = await supabase
    .from('course_staff')
    .select('role')
    .eq('course_id', courseId)
    .ilike('email', email)
    .maybeSingle();

  if (staff) return { authorized: true, role: staff.role };

  return { authorized: false };
}

/** Looks up which course a session belongs to, for guarding session-scoped routes. */
export async function courseIdForSession(sessionId) {
  const { data } = await supabase.from('sessions').select('course_id').eq('id', sessionId).maybeSingle();
  return data ? data.course_id : null;
}

export { supabase };
