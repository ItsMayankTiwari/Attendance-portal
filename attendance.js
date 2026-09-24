const SUPABASE_URL = 'https://fdjbmnpqyzsxwwgavhnd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkamJtbnBxeXpzeHd3Z2F2aG5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4NDcsImV4cCI6MjEwMzA0Nzg0N30.VxyBjad4MtjgV8uWboBimvmWBkpku4GTKj41O7QxLYg'; //[cite: 1]
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentSession = null;
let html5QrCode = null;

async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentSession = session;

  supabaseClient.auth.onAuthStateChange((_event, newSession) => {
    currentSession = newSession;
    if (!newSession) location.reload();
  });

  if (session) {
    document.getElementById('authSection').style.display = 'none';
    loadDashboard();
  }
}

document.getElementById('googleLoginBtn').onclick = async () => {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  });
  if (error) document.getElementById('authStatus').innerText = error.message;
};

async function loadDashboard() {
  try {
    const res = await fetch('/api/student-data', {
      headers: { 'Authorization': `Bearer ${currentSession.access_token}` }
    });

    // Read raw text first to prevent silent JSON parse crashes
    const rawText = await res.text();
    let data;

    try {
      data = JSON.parse(rawText);
    } catch (err) {
      throw new Error(`Server crashed (Status ${res.status}). Check Vercel logs.`);
    }

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load profile.');
    }

    if (!data.student.is_registered) {
      document.getElementById('setupSection').style.display = 'block';
      return;
    }

    document.getElementById('setupSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'block';

    document.getElementById('studentName').innerText = data.student.name;
    document.getElementById('studentRoll').innerText = data.student.roll_number;

    const courseList = document.getElementById('courseList');
    if (data.courses.length === 0) {
      courseList.innerHTML = '<p>You are not enrolled in any courses.</p>';
    } else {
      courseList.innerHTML = data.courses.map(c => `
        <button class="course-btn" onclick="startAttendance('${c.id}', '${c.course_code}')">
          <div>
            <div class="course-code">${c.course_code}</div>
            <div style="font-size: 0.85rem; color: #6b7280;">${c.course_name}</div>
          </div>
          <span>➡️</span>
        </button>
      `).join('');
    }
  } catch (error) {
    // If anything fails, bring the login screen back and show the error
    document.getElementById('authSection').style.display = 'block';
    document.getElementById('authStatus').innerText = `Dashboard Error: ${error.message}`;
    document.getElementById('authStatus').style.color = '#ef4444';
  }
}

document.getElementById('enrollBtn').onclick = async () => {
  const course_code = document.getElementById('enrollCourseCode').value.trim();
  if (!course_code) return;

  const res = await fetch('/api/student-data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentSession.access_token}`
    },
    body: JSON.stringify({ course_code })
  });

  if (res.ok) {
    document.getElementById('enrollCourseCode').value = '';
    loadDashboard();
  } else {
    const err = await res.json();
    alert(err.error);
  }
};

// ==========================================
// FINGERPRINT & ATTENDANCE LOGIC
// ==========================================

document.getElementById('registerDeviceBtn').onclick = async () => {
  const status = document.getElementById('setupStatus');
  status.innerText = 'Initializing hardware...';

  // Note: Update lib/register-options.js to read req.headers.authorization
  const optRes = await fetch('/api/register-options', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${currentSession.access_token}` }
  });
  const options = await optRes.json();

  try {
    const assertion = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
    const verifyRes = await fetch('/api/register-verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentSession.access_token}`
      },
      body: JSON.stringify({ response: assertion })
    });

    if (verifyRes.ok) loadDashboard();
    else status.innerText = 'Registration failed on server.';
  } catch (err) {
    status.innerText = err.message;
  }
};

async function startAttendance(courseId, courseCode) {
  // 1. Get Fingerprint Challenge
  const optRes = await fetch('/api/attendance-options', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${currentSession.access_token}` }
  });
  const options = await optRes.json();
  if (!optRes.ok) return alert(options.error);

  // 2. Prompt Fingerprint
  let assertion;
  try {
    assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
  } catch (err) {
    return console.log("Fingerprint cancelled");
  }

  // 3. Verify & Get 20-second token
  const verifyRes = await fetch('/api/attendance-verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentSession.access_token}`
    },
    body: JSON.stringify({ response: assertion })
  });
  const verification = await verifyRes.json();
  if (!verifyRes.ok) return alert(verification.error);

  // 4. Open Camera Scanner
  document.getElementById('dashboardSection').style.display = 'none';
  document.getElementById('scannerSection').style.display = 'block';
  document.getElementById('scanningCourseTitle').innerText = courseCode;

  html5QrCode = new Html5Qrcode("reader");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    async (decodedText) => {
      await html5QrCode.stop();
      document.getElementById('scanStatus').innerText = 'Submitting...';

      const markRes = await fetch('/api/mark-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: verification.token, qr_payload: decodedText })
      });

      const markData = await markRes.json();
      if (markRes.ok) {
        document.getElementById('scannerSection').innerHTML = `
          <h2 style="color: #059669; font-size: 2rem; margin-top: 20px;">✅</h2>
          <p style="font-weight: bold; font-size: 1.2rem;">Attendance Marked!</p>
          <button onclick="location.reload()" style="margin-top: 20px;">Back to Dashboard</button>
        `;
      } else {
        alert(markData.error);
        location.reload();
      }
    },
    () => { } // Ignore scan errors
  );
}

document.getElementById('cancelScanBtn').onclick = async () => {
  if (html5QrCode) await html5QrCode.stop();
  location.reload();
};

init();