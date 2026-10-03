import crypto from 'crypto';
import { authenticateTeacher, verifyCourseAccess, supabase } from './teacher-guard.js';
import { ROTATION_SECONDS, sessionIsLive } from './config.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    const user = await authenticateTeacher(req, res);
    if (!user) return;

    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'Missing session_id.' });

    const { data: session } = await supabase.from('sessions').select('*').eq('id', session_id).maybeSingle();
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), session.course_id);
    if (!authorized) return res.status(403).json({ error: 'Not authorized for this session.' });
    if (!sessionIsLive(session) || !session.session_secret) return res.status(410).json({ error: 'This session has ended.' });

    const now = Date.now();
    const bucket = Math.floor(now / 1000 / ROTATION_SECONDS);
    const mac = crypto.createHmac('sha256', Buffer.from(session.session_secret, 'hex'))
        .update(`${session.id}:${bucket}`).digest('hex').slice(0, 16);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
        payload: `${session.id}:${bucket}:${mac}`,
        ms_until_next: (bucket + 1) * ROTATION_SECONDS * 1000 - now
    });
}
