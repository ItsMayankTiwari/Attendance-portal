import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const JWT_SECRET = process.env.JWT_SECRET;
const ROTATION_SECONDS = 6;

function signToken(secret, session_id, bucket) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`${session_id}:${bucket}`).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { auth_token, qr_payload } = req.body;
  if (!auth_token || !qr_payload) return res.status(400).json({ error: 'Missing auth_token or qr_payload.' });

  let decoded;
  try {
    decoded = jwt.verify(auth_token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Your fingerprint session expired. Please verify again.' });
  }
  const student_id = decoded.student_id;

  const parts = qr_payload.split(':');
  if (parts.length !== 3) return res.status(400).json({ error: 'Malformed QR code.' });
  const [session_id, bucketStr, providedHmac] = parts;
  const bucket = parseInt(bucketStr, 10);

  const { data: session } = await supabase.from('sessions').select('*').eq('id', session_id).maybeSingle();
  if (!session || session.is_active === false) {
    return res.status(410).json({ error: 'This session has ended.' });
  }

  const expectedHmac = signToken(session.session_secret, session_id, bucket).slice(0, 16);
  const a = Buffer.from(providedHmac, 'hex');
  const b = Buffer.from(expectedHmac, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ error: 'Invalid QR code.' });
  }

  const currentBucket = Math.floor(Date.now() / 1000 / ROTATION_SECONDS);
  if (bucket !== currentBucket && bucket !== currentBucket - 1) {
    return res.status(400).json({ error: 'This QR code has expired — scan the current one.' });
  }

  // The course button tapped in the UI is cosmetic only — this is the real
  // check that the QR being scanned belongs to a course this student is
  // actually enrolled in, not just any currently-live session.
  const { data: enrollment } = await supabase
    .from('enrollments').select('id').eq('student_id', student_id).eq('course_id', session.course_id).maybeSingle();
  if (!enrollment) {
    return res.status(403).json({ error: "You're not enrolled in this course." });
  }

  const { error: insertError } = await supabase.from('attendance_records').insert({ student_id, session_id });
  if (insertError) {
    if (insertError.code === '23505') {
      return res.status(409).json({ error: 'You have already marked attendance for this session.' });
    }
    return res.status(500).json({ error: insertError.message });
  }

  res.status(200).json({ success: true });
}
