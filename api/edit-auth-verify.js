import { createClient } from '@supabase/supabase-js';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const rpID = process.env.RP_ID;
const origin = `https://${rpID}`;

export default async function handler(req, res) {
  const { response } = req.body;
  const studentId = Buffer.from(response.response.userHandle, 'base64url').toString('utf-8');

  const { data: student } = await supabase.from('students').select('*').eq('id', studentId).single();
  if (!student || !student.webauthn_credential) {
    return res.status(400).json({ error: 'No matching registration found.' });
  }

  // most recent unexpired-ish challenge (simple approach for course-project scale)
  const { data: pending } = await supabase
    .from('auth_challenges').select('*').order('created_at', { ascending: false }).limit(1).single();

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
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

  await supabase.from('students')
    .update({ webauthn_credential: { ...student.webauthn_credential, counter: verification.authenticationInfo.newCounter } })
    .eq('id', student.id);
  await supabase.from('auth_challenges').delete().eq('id', pending.id);

  res.status(200).json({ student_id: student.id, name: student.name, roll_number: student.roll_number });
}