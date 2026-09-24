import { createClient } from '@supabase/supabase-js';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import jwt from 'jsonwebtoken';
import { authenticateUser } from './auth-guard.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
const rpID = process.env.RP_ID;
const origin = `https://${rpID}`;
const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;
  const email = user.email.toLowerCase();

  const { response } = req.body;
  const { data: student } = await supabase.from('students').select('*').eq('email', email).single();

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

  await supabase.from('students').update({
    webauthn_credential: { ...student.webauthn_credential, counter: verification.authenticationInfo.newCounter },
    current_challenge: null
  }).eq('id', student.id);

  const token = jwt.sign({ student_id: student.id }, JWT_SECRET, { expiresIn: '20s' });
  res.status(200).json({ success: true, token });
}