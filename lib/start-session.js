import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { course_code } = req.body;
  const { data, error } = await supabase
    .from('sessions').insert({ course_code: course_code || null }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ session_id: data.id });
}