import { authenticateTeacher, verifyCourseAccess, courseIdForSession, supabase } from './teacher-guard.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const user = await authenticateTeacher(req, res);
    if (!user) return;

    const { session_id, roll_number } = req.body || {};
    if (!session_id || !roll_number) {
        return res.status(400).json({ error: 'session_id and roll_number are required.' });
    }

    const course_id = await courseIdForSession(session_id);
    if (!course_id) return res.status(404).json({ error: 'Session not found.' });

    const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), course_id);
    if (!authorized) return res.status(403).json({ error: 'Not authorized for this session.' });

    const { data: session } = await supabase.from('sessions').select('is_active').eq('id', session_id).maybeSingle();
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    if (!session.is_active) {
        return res.status(410).json({ error: 'This session has ended — attendance can no longer be added to it.' });
    }

    const { data: student } = await supabase
        .from('students').select('id, name, roll_number')
        .ilike('roll_number', roll_number.trim())
        .maybeSingle();
    if (!student) return res.status(404).json({ error: 'No student found with that roll number.' });

    const { data: enrollment } = await supabase
        .from('enrollments').select('id').eq('student_id', student.id).eq('course_id', course_id).maybeSingle();
    if (!enrollment) {
        return res.status(403).json({ error: `${student.name} is not enrolled in this course.` });
    }

    const { error: insertError } = await supabase
        .from('attendance_records').insert({ student_id: student.id, session_id });

    if (insertError) {
        if (insertError.code === '23505') {
            return res.status(409).json({ error: `${student.name} is already marked present for this session.` });
        }
        return res.status(500).json({ error: insertError.message });
    }

    res.status(200).json({ success: true, name: student.name, roll_number: student.roll_number });
}