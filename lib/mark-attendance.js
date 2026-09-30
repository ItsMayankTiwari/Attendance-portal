import crypto from 'crypto';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { authenticateUser, supabase } from './auth-guard.js';

const rpID = process.env.RP_ID;
const origin = `https://${rpID}`;
const ROTATION_SECONDS = 6;

function expectedHmac(secretHex, sessionId, bucket) {
  return crypto.createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(`${sessionId}:${bucket}`).digest('hex').slice(0, 16);
}

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

  const parts = qr_payload.split(':');
  if (parts.length !== 3) return res.status(400).json({ error: 'Malformed QR code.' });
  const [session_id, bucketStr, providedHmac] = parts;
  const bucket = parseInt(bucketStr, 10);

  const { data: session } = await supabase.from('sessions').select('*').eq('id', session_id).maybeSingle();
  if (!session || session.is_active === false) {
    return res.status(410).json({ error: 'This session has ended.' });
  }

  const expected = expectedHmac(session.session_secret, session_id, bucket);
  const a = Buffer.from(providedHmac, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ error: 'Invalid QR code.' });
  }

  const currentBucket = Math.floor(Date.now() / 1000 / ROTATION_SECONDS);
  if (bucket !== currentBucket && bucket !== currentBucket - 1) {
    return res.status(400).json({ error: 'This QR code has expired — scan the current one.' });
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