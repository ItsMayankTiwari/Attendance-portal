import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Validates the Supabase Auth access token from Authorization header.
 * Returns the user object if authenticated, or sends a 401 response and returns null.
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

  return user;
}

/**
 * Checks if the email is the course instructor or an assigned TA.
 */
export async function verifyCourseAccess(email, courseId) {
  // Check if instructor
  const { data: course } = await supabase
    .from('courses')
    .select('id')
    .eq('id', courseId)
    .ilike('instructor_email', email)
    .maybeSingle();

  if (course) return { authorized: true, role: 'INSTRUCTOR' };

  // Check if TA in course_staff
  const { data: staff } = await supabase
    .from('course_staff')
    .select('role')
    .eq('course_id', courseId)
    .ilike('email', email)
    .maybeSingle();

  if (staff) return { authorized: true, role: staff.role };

  return { authorized: false };
}