import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { authenticateUser, supabase } from './auth-guard.js';

const rpID = process.env.RP_ID;

// Step-up auth for sensitive changes: this reuses the *same* device
// credential the student registered, looked up from their authenticated
// Google session — never an open "any credential on this device" discovery.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;

  const { data: student } = await supabase.from('students').select('*').eq('email', user.email.toLowerCase()).single();
  if (!student || !student.webauthn_credential) {
    return res.status(400).json({ error: 'No registered device found for your account.' });
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [{ id: student.webauthn_credential.id, type: 'public-key' }],
    userVerification: 'required'
  });

  await supabase.from('students').update({ current_challenge: options.challenge }).eq('id', student.id);
  res.status(200).json(options);
}
