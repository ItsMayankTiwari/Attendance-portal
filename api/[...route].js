import attendanceOptions from '../lib/attendance-options.js';
import editAuthOptions from '../lib/edit-auth-options.js';
import editAuthVerify from '../lib/edit-auth-verify.js';
import endSession from '../lib/end-session.js';
import markAttendance from '../lib/mark-attendance.js';
import registerOptions from '../lib/register-options.js';
import registerVerify from '../lib/register-verify.js';
import sessionAttendance from '../lib/session-attendance.js';
import sessionQr from '../lib/session-qr.js';
import startSession from '../lib/start-session.js';
import updateProfile from '../lib/update-profile.js';
import teacherCourses from '../lib/teacher-courses.js';
import studentData from '../lib/student-data.js';
import studentRecords from '../lib/student-records.js';
import teacherRecords from '../lib/teacher-records.js';
import manageTa from '../lib/manage-ta.js';
import addAttendanceManual from '../lib/add-attendance-manual.js';
import removeEnrollment from '../lib/remove-enrollment.js';
import fixRollNumber from '../lib/fix-roll-number.js';
import courseLocations from '../lib/course-locations.js';

const routes = {
  'teacher-courses': teacherCourses,
  'attendance-options': attendanceOptions,
  'edit-auth-options': editAuthOptions,
  'edit-auth-verify': editAuthVerify,
  'end-session': endSession,
  'mark-attendance': markAttendance,
  'register-options': registerOptions,
  'register-verify': registerVerify,
  'session-attendance': sessionAttendance,
  'session-qr': sessionQr,
  'start-session': startSession,
  'update-profile': updateProfile,
  'student-data': studentData,
  'student-records': studentRecords,
  'teacher-records': teacherRecords,
  'manage-ta': manageTa,
  'add-attendance-manual': addAttendanceManual,
  'remove-enrollment': removeEnrollment,
  'fix-roll-number': fixRollNumber,
  'course-locations': courseLocations
};

export default async function handler(req, res) {
  const urlPath = req.url.split('?')[0];
  const pathSegments = urlPath.split('/').filter(Boolean);
  const path = pathSegments[pathSegments.length - 1];

  res.setHeader('Cache-Control', 'no-store');
  if (!path || !Object.hasOwn(routes, path)) return res.status(404).json({ error: 'Not found.' });
  const routeHandler = routes[path];

  try {
    await routeHandler(req, res);
  } catch (error) {
    console.error(`Error in ${path}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
