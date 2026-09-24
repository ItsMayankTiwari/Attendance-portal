import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const QR_SECRET = process.env.QR_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;
const ROTATION_SECONDS = 6;

function signToken(session_id, bucket) {
  return crypto.createHmac('sha256', QR_SECRET).update(`${session_id}:${bucket}`).digest('hex');
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

  const expectedHmac = signToken(session_id, bucket);
  const a = Buffer.from(providedHmac, 'hex');
  const b = Buffer.from(expectedHmac, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ error: 'Invalid QR code.' });
  }

  const currentBucket = Math.floor(Date.now() / 1000 / ROTATION_SECONDS);
  if (bucket !== currentBucket && bucket !== currentBucket - 1) {
    return res.status(400).json({ error: 'This QR code has expired — scan the current one.' });
  }

  const { data: session } = await supabase.from('sessions').select('*').eq('id', session_id).maybeSingle();
  if (!session || session.is_active === false) {
    return res.status(410).json({ error: 'This session has ended.' });
  }

  const { error: insertError } = await supabase.from('attendance_records').insert({ student_id, session_id });
  if (insertError) {
    if (insertError.code === '23505') { // unique(student_id, session_id) violation
      return res.status(409).json({ error: 'You have already marked attendance for this session.' });
    }
    return res.status(500).json({ error: insertError.message });
  }

  res.status(200).json({ success: true });
}