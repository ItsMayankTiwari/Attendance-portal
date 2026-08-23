import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data, error } = await supabase.from('sessions').select('*').limit(1);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ connected: true, data });
}