import { authenticateTeacher, verifyCourseAccess, supabase } from './teacher-guard.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const user = await authenticateTeacher(req, res);
    if (!user) return;

    const { course_id, roll_number } = req.body || {};
    if (!course_id || !roll_number) {
        return res.status(400).json({ error: 'course_id and roll_number are required.' });
    }

    const { authorized } = await verifyCourseAccess(user.email.toLowerCase(), course_id);
    if (!authorized) return res.status(403).json({ error: 'Not authorized for this course.' });

    const { data: student } = await supabase
        .from('students').select('id, name, roll_number')
        .eq('roll_number', String(roll_number).trim().toUpperCase())
        .maybeSingle();
    if (!student) return res.status(404).json({ error: 'No student found with that roll number.' });

    const { data: deleted, error } = await supabase
        .from('enrollments')
        .delete()
        .eq('student_id', student.id)
        .eq('course_id', course_id)
        .select();

    if (error) return res.status(500).json({ error: error.message });
    if (!deleted || deleted.length === 0) {
        return res.status(404).json({ error: `${student.name} isn't enrolled in this course.` });
    }

    res.status(200).json({ success: true, name: student.name, roll_number: student.roll_number });
}