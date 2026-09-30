import crypto from 'crypto';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { authenticateUser, supabase } from './auth-guard.js';

const rpID = process.env.RP_ID;
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

  const { qr_payload } = req.body || {};
  if (!qr_payload) return res.status(400).json({ error: 'Scan the QR code first.' });

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

  const { data: student } = await supabase.from('students').select('*').eq('email', email).single();
  if (!student || !student.webauthn_credential) {
    return res.status(404).json({ error: 'Fingerprint not enrolled.' });
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [{ id: student.webauthn_credential.id, type: 'public-key' }],
    userVerification: 'required'
  });

  await supabase.from('students').update({
    current_challenge: options.challenge,
    pending_qr_payload: qr_payload
  }).eq('id', student.id);

  res.status(200).json(options);
}