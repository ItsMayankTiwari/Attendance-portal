import jwt from 'jsonwebtoken';
import { authenticateUser, supabase } from './auth-guard.js';

const JWT_SECRET = process.env.JWT_SECRET;
const ROLL_NUMBER_PATTERN = /^[A-Z0-9]{4,15}$/;

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;

  const { data: student } = await supabase.from('students').select('id').eq('email', user.email.toLowerCase()).single();
  if (!student) return res.status(404).json({ error: 'Account not found.' });

  const { name, roll_number, edit_token } = req.body;

  let decoded;
  try {
    decoded = jwt.verify(edit_token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Your verification expired. Please verify your fingerprint again.' });
  }
  // The token must be for THIS purpose and THIS exact account — it cannot
  // be replayed against a different profile even if somehow intercepted.
  if (decoded.purpose !== 'edit_profile' || decoded.student_id !== student.id) {
    return res.status(403).json({ error: 'This verification does not match your account.' });
  }

  const cleanName = (name || '').trim();
  const cleanRoll = (roll_number || '').trim().toUpperCase();

  if (!cleanName || cleanName.length > 80) return res.status(400).json({ error: 'Enter a valid name.' });
  if (!ROLL_NUMBER_PATTERN.test(cleanRoll)) return res.status(400).json({ error: 'Roll number should be 4–15 letters or numbers.' });

  const { data: collision } = await supabase
    .from('students').select('id').eq('roll_number', cleanRoll).neq('id', student.id).maybeSingle();
  if (collision) return res.status(409).json({ error: 'That roll number belongs to someone else.' });

  const { error } = await supabase.from('students').update({ name: cleanName, roll_number: cleanRoll }).eq('id', student.id);
  if (error) return res.status(500).json({ error: error.message });

  res.status(200).json({ success: true });
}
