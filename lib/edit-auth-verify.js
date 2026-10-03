import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import jwt from 'jsonwebtoken';
import { authenticateUser, supabase } from './auth-guard.js';

const rpID = process.env.RP_ID;
const origin = `https://${rpID}`;
const JWT_SECRET = process.env.JWT_SECRET;
const ALLOWED_PURPOSES = new Set(['edit_profile', 'reset_device']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;

  const { response, purpose } = req.body || {};
  const safePurpose = ALLOWED_PURPOSES.has(purpose) ? purpose : 'edit_profile';

  const { data: student } = await supabase.from('students').select('*').eq('email', user.email.toLowerCase()).single();

  if (!student || !student.current_challenge) {
    return res.status(400).json({ error: 'No pending verification found. Try again.' });
  }
  if (student.challenge_purpose !== 'edit' || !student.challenge_expires_at || new Date(student.challenge_expires_at) < new Date()) {
    return res.status(400).json({ error: 'Verification timed out. Try again.' });
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
  if (!verification.verified) return res.status(400).json({ error: 'Verification failed.' });

  await supabase.from('students').update({
    webauthn_credential: { ...student.webauthn_credential, counter: verification.authenticationInfo.newCounter },
    current_challenge: null,
    challenge_purpose: null,
    challenge_expires_at: null
  }).eq('id', student.id);

  const edit_token = jwt.sign({ student_id: student.id, purpose: safePurpose }, JWT_SECRET, { expiresIn: '2m' });
  res.status(200).json({ edit_token });
}