import { generateRegistrationOptions } from '@simplewebauthn/server';
import jwt from 'jsonwebtoken';
import { authenticateUser, supabase } from './auth-guard.js';

const rpID = process.env.RP_ID;
const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authenticateUser(req, res);
  if (!user) return;
  const email = user.email.toLowerCase();

  const { data: student } = await supabase.from('students').select('*').eq('email', email).single();
  if (!student) return res.status(404).json({ error: 'Student record not found. Please reload the page.' });

  if (student.webauthn_credential) {
    const { reset_token } = req.body || {};
    let decoded = null;
    try { decoded = reset_token ? jwt.verify(reset_token, JWT_SECRET) : null; } catch (err) { decoded = null; }
    const validReset = decoded && decoded.purpose === 'reset_device' && decoded.student_id === student.id;
    if (!validReset) {
      return res.status(409).json({
        error: 'A device is already registered on this account. Verify your existing fingerprint to replace it.',
        needs_reset_verification: true
      });
    }
  }

  const options = await generateRegistrationOptions({
    rpName: 'Class Attendance',
    rpID,
    userID: Buffer.from(student.id, 'utf-8'),
    userName: student.email,
    userDisplayName: student.name,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' }
  });

  await supabase.from('students').update({ current_challenge: options.challenge }).eq('id', student.id);
  res.status(200).json(options);
}