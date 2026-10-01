import { authenticateTeacher, verifyCourseAccess, supabase } from './teacher-guard.js';

export default async function handler(req, res) {
    const user = await authenticateTeacher(req, res);
    if (!user) return;
    const email = user.email.toLowerCase();

    if (req.method === 'GET') {
        const { course_id } = req.query;
        if (!course_id) return res.status(400).json({ error: 'course_id is required.' });

        const { authorized, role } = await verifyCourseAccess(email, course_id);
        if (!authorized || role !== 'INSTRUCTOR') {
            return res.status(403).json({ error: 'Only the course instructor can view TAs.' });
        }

        const { data, error } = await supabase
            .from('course_staff')
            .select('id, email, role, created_at')
            .eq('course_id', course_id)
            .order('created_at', { ascending: true });

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
    }

    if (req.method === 'POST') {
        const { action, course_id, ta_email } = req.body || {};
        if (!course_id) return res.status(400).json({ error: 'course_id is required.' });

        const { authorized, role } = await verifyCourseAccess(email, course_id);
        if (!authorized || role !== 'INSTRUCTOR') {
            return res.status(403).json({ error: 'Only the course instructor can manage TAs.' });
        }

        if (action === 'add') {
            if (!ta_email) return res.status(400).json({ error: 'ta_email is required.' });
            const normalized = ta_email.trim().toLowerCase();

            if (normalized === email) {
                return res.status(400).json({ error: "You're already the instructor for this course." });
            }

            const { data, error } = await supabase
                .from('course_staff')
                .insert({ course_id, email: normalized, role: 'TA' })
                .select().single();

            if (error) {
                if (error.code === '23505') return res.status(409).json({ error: 'That TA is already added.' });
                return res.status(500).json({ error: error.message });
            }
            return res.status(200).json(data);
        }

        if (action === 'remove') {
            if (!ta_email) return res.status(400).json({ error: 'ta_email is required.' });

            const { error } = await supabase
                .from('course_staff')
                .delete()
                .eq('course_id', course_id)
                .eq('role', 'TA')
                .ilike('email', ta_email.trim());

            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: 'Invalid action.' });
    }

    return res.status(405).end();
}