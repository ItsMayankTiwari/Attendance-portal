import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const INSTITUTE_DOMAIN = (process.env.INSTITUTE_DOMAIN || 'iitj.ac.in').toLowerCase();

/**
 * Verifies the Supabase Auth access token AND that the email belongs to the
 * institute domain. The client hints Google to only show @iitj.ac.in
 * accounts, but that is a UX nicety only — this check is the real gate,
 * since anyone can hand-craft a request straight to the API.
 */
export async function authenticateUser(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header.' });
    return null;
  }
  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user || !user.email) {
    res.status(401).json({ error: 'Invalid session. Please log in again.' });
    return null;
  }

  if (!user.email.toLowerCase().endsWith('@' + INSTITUTE_DOMAIN)) {
    res.status(403).json({ error: `Please sign in with your @${INSTITUTE_DOMAIN} account.` });
    return null;
  }

  return user;
}

export { supabase };
