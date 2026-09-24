import { createClient } from '@supabase/supabase-js';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const rpID = process.env.RP_ID;
const origin = `https://${rpID}`;
const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  let { roll_number, response } = req.body;
  roll_number = roll_number.trim().toUpperCase();

  const { data: student } = await supabase
    .from('students')
    .select('*')
    .eq('roll_number', roll_number)
    .single();

  if (!student || !student.current_challenge) {
    return res.status(400).json({ error: 'No pending authentication found.' });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: student.current_challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: student.webauthn_credential.id,
        publicKey: Buffer.from(student.webauthn_credential.publicKey, 'base64'),
        counter: student.webauthn_credential.counter
      }
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!verification.verified) return res.status(400).json({ error: 'Fingerprint verification failed.' });

  // Clear challenge and update replay-attack counter
  await supabase.from('students').update({
    webauthn_credential: { ...student.webauthn_credential, counter: verification.authenticationInfo.newCounter },
    current_challenge: null
  }).eq('id', student.id);

  // Issue the 20-second proof-of-authentication token
  const token = jwt.sign({ student_id: student.id }, JWT_SECRET, { expiresIn: '20s' });
  
  res.status(200).json({ success: true, token });
}