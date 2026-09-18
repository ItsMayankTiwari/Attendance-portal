import { createClient } from '@supabase/supabase-js';
import { generateAuthenticationOptions } from '@simplewebauthn/server';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const rpID = process.env.RP_ID;

export default async function handler(req, res) {
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required'
    // no allowCredentials -> browser shows its own account picker
  });
  await supabase.from('auth_challenges').insert({ challenge: options.challenge });
  res.status(200).json(options);
}