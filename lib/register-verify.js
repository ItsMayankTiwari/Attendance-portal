import { createClient } from '@supabase/supabase-js';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { authenticateUser } from './auth-guard.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
const rpID = process.env.RP_ID;
const origin = `https://${rpID}`;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const user = await authenticateUser(req, res);
    if (!user) return;
    const email = user.email.toLowerCase();

    const { response } = req.body;
    const { data: student } = await supabase.from('students').select('*').eq('email', email).single();
    
    if (!student || !student.current_challenge) {
        return res.status(400).json({ error: 'No pending registration found.' });
    }

    let verification;
    try {
        verification = await verifyRegistrationResponse({
            response,
            expectedChallenge: student.current_challenge,
            expectedOrigin: origin,
            expectedRPID: rpID
        });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    if (!verification.verified) return res.status(400).json({ error: 'Fingerprint verification failed.' });

    const { credential } = verification.registrationInfo;
    await supabase.from('students').update({
        webauthn_credential: {
            id: credential.id,
            publicKey: Buffer.from(credential.publicKey).toString('base64'),
            counter: credential.counter
        },
        current_challenge: null
    }).eq('id', student.id);

    res.status(200).json({ success: true });
}