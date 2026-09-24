import attendanceOptions from '../lib/attendance-options.js';
import attendanceVerify from '../lib/attendance-verify.js';
import editAuthOptions from '../lib/edit-auth-options.js';
import editAuthVerify from '../lib/edit-auth-verify.js';
import endSession from '../lib/end-session.js';
import markAttendance from '../lib/mark-attendance.js';
import qrToken from '../lib/qr-token.js';
import registerOptions from '../lib/register-options.js';
import registerVerify from '../lib/register-verify.js';
import sessionAttendance from '../lib/session-attendance.js';
import startSession from '../lib/start-session.js';
import updateProfile from '../lib/update-profile.js';

const routes = {
  'attendance-options': attendanceOptions,
  'attendance-verify': attendanceVerify,
  'edit-auth-options': editAuthOptions,
  'edit-auth-verify': editAuthVerify,
  'end-session': endSession,
  'mark-attendance': markAttendance,
  'qr-token': qrToken,
  'register-options': registerOptions,
  'register-verify': registerVerify,
  'session-attendance': sessionAttendance,
  'start-session': startSession,
  'update-profile': updateProfile
};

export default async function handler(req, res) {
  const { route } = req.query; 
  const path = Array.isArray(route) ? route[0] : route;

  const routeHandler = routes[path];

  if (!routeHandler) {
    return res.status(404).json({ error: `API route /api/${path} not found` });
  }

  try {
    await routeHandler(req, res);
  } catch (error) {
    console.error(`Error in ${path}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}