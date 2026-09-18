import { createClient } from '@supabase/supabase-js';
import { generateRegistrationOptions } from '@simplewebauthn/server';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const rpID = process.env.RP_ID;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const { roll_number, name, device_id } = req.body;
    if (!roll_number || !name || !device_id) {
        return res.status(400).json({ error: 'Missing roll_number, name, or device_id' });
    }

    // device-level check: has this browser already registered someone?
    const { data: deviceMatch } = await supabase
        .from('students').select('roll_number').eq('device_id', device_id).maybeSingle();
    if (deviceMatch) {
        return res.status(409).json({
            error: `This device is already registered (Roll: ${deviceMatch.roll_number}). Use "Edit my details" instead, or contact your instructor.`
        });
    }

    // roll number already taken?
    const { data: rollMatch } = await supabase
        .from('students').select('id').eq('roll_number', roll_number).maybeSingle();
    if (rollMatch) {
        return res.status(409).json({ error: 'This roll number is already registered.' });
    }

    const { data: student, error: insertError } = await supabase
        .from('students').insert({ roll_number, name, device_id }).select().single();
    if (insertError) return res.status(500).json({ error: insertError.message });

    const options = await generateRegistrationOptions({
        rpName: 'Class Attendance',
        rpID,
        userID: Buffer.from(student.id, 'utf-8'),
        userName: roll_number,
        userDisplayName: name,
        attestationType: 'none',
        authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'required',
            authenticatorAttachment: 'platform'
        }
    });

    await supabase.from('students').update({ current_challenge: options.challenge }).eq('id', student.id);
    res.status(200).json(options);
}