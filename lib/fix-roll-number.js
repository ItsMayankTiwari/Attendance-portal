import { authenticateUser, supabase } from './auth-guard.js';

const AUTHORIZED_PROFESSORS = (process.env.AUTHORIZED_PROFESSOR_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const ROLL_NUMBER_PATTERN = /^[A-Z0-9]{4,15}$/;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const user = await authenticateUser(req, res);
    if (!user) return;
    if (!AUTHORIZED_PROFESSORS.includes(user.email.toLowerCase())) {
        return res.status(403).json({ error: 'Only the professor can correct roll numbers.' });
    }

    const { student_email, new_roll_number } = req.body || {};
    const email = String(student_email || '').trim().toLowerCase();
    const roll = String(new_roll_number || '').trim().toUpperCase();

    if (!/@iitj\.ac\.in$/.test(email)) return res.status(400).json({ error: 'Enter the student\'s institute email.' });
    if (!ROLL_NUMBER_PATTERN.test(roll)) return res.status(400).json({ error: 'Roll number should be 4–15 letters or numbers.' });

    const { data: student } = await supabase.from('students').select('id, roll_number').eq('email', email).maybeSingle();
    if (!student) return res.status(404).json({ error: 'No student with that email.' });

    const { data: clash } = await supabase.from('students').select('id').eq('roll_number', roll).neq('id', student.id).maybeSingle();
    if (clash) return res.status(409).json({ error: 'That roll number already belongs to another student.' });

    const { error } = await supabase.from('students').update({ roll_number: roll }).eq('id', student.id);
    if (error) return res.status(500).json({ error: 'Could not update.' });

    console.log(`roll fix by ${user.email}: ${email} ${student.roll_number} -> ${roll}`);
    res.status(200).json({ success: true });
}