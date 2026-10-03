import jwt from 'jsonwebtoken';
import { authenticateUser, supabase } from './auth-guard.js';

const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;

  const { data: student } = await supabase.from('students').select('id').eq('email', user.email.toLowerCase()).maybeSingle();
  if (!student) return res.status(404).json({ error: 'Account not found.' });

  const { name, edit_token } = req.body || {};
  let decoded;
  try { decoded = jwt.verify(edit_token, JWT_SECRET, { algorithms: ['HS256'] }); }
  catch (err) { return res.status(401).json({ error: 'Your verification expired. Please verify your fingerprint again.' }); }
  if (decoded.purpose !== 'edit_profile' || decoded.student_id !== student.id) {
    return res.status(403).json({ error: 'This verification does not match your account.' });
  }

  const cleanName = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleanName || cleanName.length > 80) return res.status(400).json({ error: 'Enter a valid name.' });

  const { error } = await supabase.from('students').update({ name: cleanName }).eq('id', student.id);
  if (error) return res.status(500).json({ error: 'Could not save.' });
  res.status(200).json({ success: true });
}
