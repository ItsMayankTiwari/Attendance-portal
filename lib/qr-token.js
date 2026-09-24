import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const QR_SECRET = process.env.QR_SECRET;
const ROTATION_SECONDS = 6;

function signToken(session_id, bucket) {
  return crypto.createHmac('sha256', QR_SECRET).update(`${session_id}:${bucket}`).digest('hex');
}

export default async function handler(req, res) {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const { data: session } = await supabase.from('sessions').select('*').eq('id', session_id).maybeSingle();
  if (!session || session.is_active === false) {
    return res.status(410).json({ error: 'Session not found or has ended.' });
  }

  const bucket = Math.floor(Date.now() / 1000 / ROTATION_SECONDS);
  const hmac = signToken(session_id, bucket);
  res.status(200).json({ payload: `${session_id}:${bucket}:${hmac}`, rotation_seconds: ROTATION_SECONDS });
}