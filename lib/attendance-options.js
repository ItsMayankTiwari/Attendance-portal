import { createClient } from '@supabase/supabase-js';
import { generateAuthenticationOptions } from '@simplewebauthn/server';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const rpID = process.env.RP_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  let { roll_number } = req.body;
  if (!roll_number) return res.status(400).json({ error: 'Roll number required.' });
  roll_number = roll_number.trim().toUpperCase();

  const { data: student } = await supabase
    .from('students')
    .select('*')
    .eq('roll_number', roll_number)
    .single();

  if (!student || !student.webauthn_credential) {
    return res.status(404).json({ error: 'Student not found or fingerprint not enrolled.' });
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [{
      id: student.webauthn_credential.id,
      type: 'public-key',
    }],
    userVerification: 'required'
  });

  await supabase.from('students').update({ current_challenge: options.challenge }).eq('id', student.id);
  res.status(200).json(options);
}