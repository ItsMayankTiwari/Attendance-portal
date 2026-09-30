import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { authenticateUser, supabase } from './auth-guard.js';

const rpID = process.env.RP_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;
  const email = user.email.toLowerCase();

  const { qr_payload } = req.body || {};
  if (!qr_payload) return res.status(400).json({ error: 'Scan the QR code first.' });

  const { data: student } = await supabase.from('students').select('*').eq('email', email).single();
  if (!student || !student.webauthn_credential) {
    return res.status(404).json({ error: 'Fingerprint not enrolled.' });
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [{ id: student.webauthn_credential.id, type: 'public-key' }],
    userVerification: 'required'
  });

  await supabase.from('students').update({
    current_challenge: options.challenge,
    pending_qr_payload: qr_payload
  }).eq('id', student.id);

  res.status(200).json(options);
}