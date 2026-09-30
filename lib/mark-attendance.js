import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { authenticateUser, supabase } from './auth-guard.js';

const rpID = process.env.RP_ID;
const origin = `https://${rpID}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;
  const email = user.email.toLowerCase();

  const { response, qr_payload } = req.body || {};
  if (!response || !qr_payload) {
    return res.status(400).json({ error: 'Missing fingerprint response or QR payload.' });
  }

  const { data: student } = await supabase.from('students').select('*').eq('email', email).single();
  if (!student || !student.webauthn_credential || !student.current_challenge) {
    return res.status(400).json({ error: 'No pending attendance check. Scan the QR code again.' });
  }

  // Already validated as fresh + genuine in attendance-options. We only
  // need to confirm it's the SAME QR — re-checking wall-clock time here
  // would unfairly fail a student whose fingerprint prompt just took a
  // few extra seconds.
  if (student.pending_qr_payload !== qr_payload) {
    return res.status(400).json({ error: 'That QR code has changed. Please scan again.' });
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
    current_challenge: null,
    pending_qr_payload: null
  }).eq('id', student.id);

  const session_id = qr_payload.split(':')[0];
  const { data: session } = await supabase.from('sessions').select('*').eq('id', session_id).maybeSingle();
  if (!session || session.is_active === false) {
    return res.status(410).json({ error: 'This session has ended.' });
  }

  const { data: enrollment } = await supabase
    .from('enrollments').select('id').eq('student_id', student.id).eq('course_id', session.course_id).maybeSingle();
  if (!enrollment) {
    return res.status(403).json({ error: "You're not enrolled in this course." });
  }

  const { error: insertError } = await supabase.from('attendance_records').insert({ student_id: student.id, session_id });
  if (insertError) {
    if (insertError.code === '23505') {
      return res.status(409).json({ error: 'You have already marked attendance for this session.' });
    }
    return res.status(500).json({ error: insertError.message });
  }

  res.status(200).json({ success: true });
}