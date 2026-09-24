import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  // Supabase automatically performs the SQL JOIN based on the foreign key relation
  const { data, error } = await supabase
    .from('attendance_records')
    .select(`
      marked_at,
      students ( roll_number, name )
    `)
    .eq('session_id', session_id)
    .order('marked_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
}