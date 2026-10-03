import crypto from 'crypto';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { authenticateUser, supabase } from './auth-guard.js';
import { ROTATION_SECONDS, CHALLENGE_TTL_MS, sessionIsLive } from './config.js';

const rpID = process.env.RP_ID;

function expectedHmac(secretHex, sessionId, bucket) {
  return crypto.createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(`${sessionId}:${bucket}`).digest('hex').slice(0, 16);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;
  const email = user.email.toLowerCase();

  const { qr_payload } = req.body || {};
  if (typeof qr_payload !== 'string' || !qr_payload) return res.status(400).json({ error: 'Scan the QR code first.' });

  const parts = qr_payload.split(':');
  if (parts.length !== 3) return res.status(400).json({ error: 'Malformed QR code.' });
  const [session_id, bucketStr, providedHmac] = parts;
  const bucket = Number(bucketStr);
  if (!Number.isInteger(bucket) || !/^[0-9a-f]{16}$/.test(providedHmac)) {
    return res.status(400).json({ error: 'Malformed QR code.' });
  }

  const { data: session } = await supabase.from('sessions').select('*').eq('id', session_id).maybeSingle();
  if (!sessionIsLive(session) || !session.session_secret) return res.status(410).json({ error: 'This session has ended.' });

  const a = Buffer.from(providedHmac, 'hex');
  const b = Buffer.from(expectedHmac(session.session_secret, session_id, bucket), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ error: 'Invalid QR code.' });

  const currentBucket = Math.floor(Date.now() / 1000 / ROTATION_SECONDS);
  if (bucket !== currentBucket && bucket !== currentBucket - 1) {
    return res.status(400).json({ error: 'This QR code has expired — scan the current one.' });
  }

  const { data: student } = await supabase.from('students').select('*').eq('email', email).maybeSingle();
  if (!student || !student.webauthn_credential) return res.status(404).json({ error: 'Fingerprint not enrolled.' });

  const { data: enrollment } = await supabase.from('enrollments').select('id')
    .eq('student_id', student.id).eq('course_id', session.course_id).maybeSingle();
  if (!enrollment) return res.status(403).json({ error: "You're not enrolled in this course." });

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [{ id: student.webauthn_credential.id, type: 'public-key' }],
    userVerification: 'required'
  });

  const { error: saveErr } = await supabase.from('students').update({
    current_challenge: options.challenge,
    pending_qr_payload: qr_payload,
    challenge_purpose: 'attendance',
    challenge_expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()
  }).eq('id', student.id);
  if (saveErr) return res.status(500).json({ error: 'Could not start verification. Try again.' });

  res.status(200).json(options);
}
