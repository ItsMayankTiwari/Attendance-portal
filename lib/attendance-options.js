import { createClient } from '@supabase/supabase-js';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { authenticateUser } from './auth-guard.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
const rpID = process.env.RP_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;
  const email = user.email.toLowerCase();

  const { data: student } = await supabase.from('students').select('*').eq('email', email).single();

  if (!student || !student.webauthn_credential) {
    return res.status(404).json({ error: 'Fingerprint not enrolled.' });
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [{
      id: student.webauthn_credential.id,
      type: 'public-key',
    }],
    userVerification: 'required'
  });

  await supabase.from('students').update({ current_challenge: options.challenge }).eq('id', student.id);
  res.status(200).json(options);
}