import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).end();
  const { student_id, name, roll_number } = req.body;

  const { data: collision } = await supabase
    .from('students').select('id').eq('roll_number', roll_number).neq('id', student_id).maybeSingle();
  if (collision) return res.status(409).json({ error: 'That roll number belongs to someone else.' });

  const { error } = await supabase.from('students').update({ name, roll_number }).eq('id', student_id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ success: true });
}