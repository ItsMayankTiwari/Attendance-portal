import { generateRegistrationOptions } from '@simplewebauthn/server';
import { authenticateUser, supabase } from './auth-guard.js';

const rpID = process.env.RP_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;
  const email = user.email.toLowerCase();

  const { data: student } = await supabase.from('students').select('*').eq('email', email).single();
  if (!student) return res.status(404).json({ error: 'Student record not found. Please reload the page.' });

  const options = await generateRegistrationOptions({
    rpName: 'Class Attendance',
    rpID,
    userID: Buffer.from(student.id, 'utf-8'),
    userName: student.email,
    userDisplayName: student.name,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' }
  });

  await supabase.from('students').update({ current_challenge: options.challenge }).eq('id', student.id);
  res.status(200).json(options);
}
