import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import jwt from 'jsonwebtoken';
import { authenticateUser, supabase } from './auth-guard.js';

const rpID = process.env.RP_ID;
const origin = `https://${rpID}`;
const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;

  const { response } = req.body;
  const { data: student } = await supabase.from('students').select('*').eq('email', user.email.toLowerCase()).single();

  if (!student || !student.current_challenge) {
    return res.status(400).json({ error: 'No pending verification found. Try again.' });
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
    current_challenge: null
  }).eq('id', student.id);

  // Short-lived proof that THIS authenticated account just re-verified its
  // own fingerprint. update-profile checks this and the Google session
  // together, and only ever touches the row they both point at.
  const edit_token = jwt.sign({ student_id: student.id, purpose: 'edit_profile' }, JWT_SECRET, { expiresIn: '2m' });
  res.status(200).json({ edit_token });
}
