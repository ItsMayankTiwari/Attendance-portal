import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { authenticateUser, supabase } from './auth-guard.js';
import { sessionIsLive } from './config.js';

const rpID = process.env.RP_ID;
const origin = `https://${rpID}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;
  const email = user.email.toLowerCase();

  const { response, qr_payload } = req.body || {};
  if (!response || typeof qr_payload !== 'string') {
    return res.status(400).json({ error: 'Missing fingerprint response or QR payload.' });
  }

  const { data: student } = await supabase.from('students').select('*').eq('email', email).maybeSingle();
  if (!student || !student.webauthn_credential || !student.current_challenge || student.challenge_purpose !== 'attendance') {
    return res.status(400).json({ error: 'No pending attendance check. Scan the QR code again.' });
  }
  if (!student.challenge_expires_at || new Date(student.challenge_expires_at) < new Date()) {
    return res.status(400).json({ error: 'Verification timed out. Scan the QR code again.' });
  }
  if (student.pending_qr_payload !== qr_payload) {
    return res.status(400).json({ error: 'That QR code has changed. Please scan again.' });
  }

  const { data: consumed } = await supabase.from('students')
    .update({ current_challenge: null, pending_qr_payload: null, challenge_purpose: null, challenge_expires_at: null })
    .eq('id', student.id).eq('current_challenge', student.current_challenge).select('id');
  if (!consumed || consumed.length === 0) {
    return res.status(400).json({ error: 'This verification was already used. Scan the QR code again.' });
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
    console.error('mark-attendance verify:', err.message);
    return res.status(400).json({ error: 'Fingerprint verification failed.' });
  }
  if (!verification.verified) return res.status(400).json({ error: 'Fingerprint verification failed.' });

  await supabase.from('students').update({
    webauthn_credential: { ...student.webauthn_credential, counter: verification.authenticationInfo.newCounter }
  }).eq('id', student.id);

  const session_id = qr_payload.split(':')[0];
  const bucketStr = qr_payload.split(':')[1];
  const bucket = Number(bucketStr);

  const { data: session } = await supabase.from('sessions').select('*').eq('id', session_id).maybeSingle();
  if (!sessionIsLive(session)) return res.status(410).json({ error: 'This session has ended.' });

  // Strictly enforce the 8-second window (2 buckets) at the time of final submission!
  // This prevents students from scanning a valid QR, then waiting 2 minutes to use their fingerprint.
  const { ROTATION_SECONDS } = await import('./config.js');
  const currentBucket = Math.floor(Date.now() / 1000 / ROTATION_SECONDS);
  if (bucket !== currentBucket && bucket !== currentBucket - 1) {
    return res.status(400).json({ error: 'QR code expired while verifying fingerprint. You must scan and verify quickly!' });
  }

  const { data: enrollment } = await supabase.from('enrollments').select('id')
    .eq('student_id', student.id).eq('course_id', session.course_id).maybeSingle();
  if (!enrollment) return res.status(403).json({ error: "You're not enrolled in this course." });

  const { error: insertError } = await supabase.from('attendance_records').insert({ student_id: student.id, session_id });
  if (insertError) {
    if (insertError.code === '23505') return res.status(409).json({ error: 'You have already marked attendance for this session.' });
    return res.status(500).json({ error: 'Could not save attendance.' });
  }
  res.status(200).json({ success: true });
}
