const SUPABASE_URL = 'https://fdjbmnpqyzsxwwgavhnd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkamJtbnBxeXpzeHd3Z2F2aG5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4NDcsImV4cCI6MjEwMzA0Nzg0N30.VxyBjad4MtjgV8uWboBimvmWBkpku4GTKj41O7QxLYg'; //[cite: 1]
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentSession = null;
let activeSessionId = null;
let pollTimer = null;
let realtimeSubscription = null;
let scanCount = 0;

// 1. Auth Lifecycle
async function initAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  handleAuthState(session);

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    handleAuthState(session);
  });
}

function handleAuthState(session) {
  currentSession = session;
  if (session) {
    document.getElementById('authSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'block';
    document.getElementById('userBadge').innerText = session.user.email;
    loadCourses();
  } else {
    document.getElementById('authSection').style.display = 'block';
    document.getElementById('dashboardSection').style.display = 'none';
    document.getElementById('qrSection').style.display = 'none';
  }
}

document.getElementById('googleLoginBtn').onclick = async () => {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  });
  if (error) document.getElementById('authStatus').innerText = error.message;
};

document.getElementById('logoutBtn').onclick = async () => {
  await supabaseClient.auth.signOut();
};

// 2. Course Management
async function loadCourses() {
  const res = await fetch('/api/teacher-courses', {
    headers: { 'Authorization': `Bearer ${currentSession.access_token}` }
  });
  if (!res.ok) return;
  const courses = await res.json();

  const courseSelect = document.getElementById('courseSelect');
  const taCourseSelect = document.getElementById('taCourseSelect');

  courseSelect.innerHTML = '<option value="">-- Select a Course --</option>';
  taCourseSelect.innerHTML = '<option value="">-- Assign TA to Course --</option>';

  const recordCourseSelect = document.getElementById('recordCourseSelect');
  recordCourseSelect.innerHTML = '<option value="">-- Select Course --</option>';

  courses.forEach(c => {
    const opt = `<option value="${c.id}">${c.course_code} - ${c.course_name} (${c.user_role})</option>`;
    courseSelect.innerHTML += opt;
    recordCourseSelect.innerHTML += opt;
    if (c.user_role === 'INSTRUCTOR') {
      taCourseSelect.innerHTML += opt;
    }
  });
}

document.getElementById('createCourseBtn').onclick = async () => {
  const course_code = document.getElementById('newCourseCode').value.trim();
  const course_name = document.getElementById('newCourseName').value.trim();
  if (!course_code || !course_name) return alert('Enter course code and name.');

  const res = await fetch('/api/teacher-courses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentSession.access_token}`
    },
    body: JSON.stringify({ action: 'create_course', course_code, course_name })
  });

  const data = await res.json();
  if (!res.ok) return alert(data.error);

  alert('Course created successfully.');
  document.getElementById('newCourseCode').value = '';
  document.getElementById('newCourseName').value = '';
  loadCourses();
};

document.getElementById('addTaBtn').onclick = async () => {
  const course_id = document.getElementById('taCourseSelect').value;
  const ta_email = document.getElementById('taEmail').value.trim();
  if (!course_id || !ta_email) return alert('Select a course and provide a TA email.');

  const res = await fetch('/api/teacher-courses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentSession.access_token}`
    },
    body: JSON.stringify({ action: 'add_ta', course_id, ta_email })
  });

  const data = await res.json();
  if (!res.ok) return alert(data.error);

  alert('TA added successfully.');
  document.getElementById('taEmail').value = '';
};

// 3. Live Session & Rotating QR Code
document.getElementById('startBtn').onclick = async () => {
  const course_id = document.getElementById('courseSelect').value;
  if (!course_id) return alert('Select a course first.');

  const res = await fetch('/api/start-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentSession.access_token}`
    },
    body: JSON.stringify({ course_id })
  });

  const data = await res.json();
  if (!res.ok) return alert(data.error);

  activeSessionId = data.session_id;
  document.getElementById('dashboardSection').style.display = 'none';
  document.getElementById('qrSection').style.display = 'block';

  scanCount = 0;
  document.getElementById('scanCount').innerText = scanCount;

  fetchLiveRoster();
  refreshQR();
  setupRealtimeListener(activeSessionId);
};

function setupRealtimeListener(sessionId) {
  if (realtimeSubscription) supabaseClient.removeChannel(realtimeSubscription);

  realtimeSubscription = supabaseClient.channel(`session_${sessionId}`);
  realtimeSubscription
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'attendance_records',
      filter: `session_id=eq.${sessionId}`
    }, () => {
      scanCount++;
      document.getElementById('scanCount').innerText = scanCount;
      fetchLiveRoster();
    })
    .subscribe();
}

async function refreshQR() {
  const res = await fetch(`/api/qr-token?session_id=${activeSessionId}`);
  if (!res.ok) {
    clearInterval(pollTimer);
    return;
  }
  const data = await res.json();

  const qrBox = document.getElementById('qrBox');
  qrBox.innerHTML = '';
  new QRCode(qrBox, {
    text: data.payload,
    width: 250,
    height: 250,
    colorDark: '#000000',
    colorLight: '#ffffff'
  });

  if (!pollTimer) pollTimer = setInterval(refreshQR, data.rotation_seconds * 1000);
}

async function fetchLiveRoster() {
  const res = await fetch(`/api/session-attendance?session_id=${activeSessionId}`);
  if (!res.ok) return;
  const records = await res.json();

  const scanList = document.getElementById('scanList');
  if (records.length === 0) {
    scanList.innerHTML = '<li>No scans recorded yet.</li>';
    return;
  }

  scanList.innerHTML = records.map(record => {
    const time = new Date(record.marked_at).toLocaleTimeString();
    return `<li style="padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <strong>${record.students.roll_number}</strong> - ${record.students.name}
      <span style="font-size: 0.75rem; float: right;">${time}</span>
    </li>`;
  }).join('');
}

document.getElementById('endBtn').onclick = async () => {
  await fetch('/api/end-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: activeSessionId })
  });

  clearInterval(pollTimer);
  pollTimer = null;
  if (realtimeSubscription) supabaseClient.removeChannel(realtimeSubscription);

  document.getElementById('qrSection').style.display = 'none';
  document.getElementById('dashboardSection').style.display = 'block';
};

// Initialize on page load
initAuth();

document.getElementById('fetchRecordsBtn').onclick = async () => {
  const course_id = document.getElementById('recordCourseSelect').value;
  if (!course_id) return alert('Please select a course.');

  const container = document.getElementById('teacherRecordsContainer');
  container.innerHTML = '<p>Loading student data...</p>';

  const res = await fetch(`/api/teacher-records?course_id=${course_id}`, {
    headers: { 'Authorization': `Bearer ${currentSession.access_token}` }
  });
  
  if (!res.ok) {
    container.innerHTML = '<p style="color:red;">Failed to load records.</p>';
    return;
  }
  
  const data = await res.json();
  
  if (data.stats.length === 0) {
    container.innerHTML = '<p>No students enrolled in this course.</p>';
    return;
  }

  const tableRows = data.stats.map(s => {
    let datesHtml = s.dates_present.map(d => `<li>${new Date(d).toLocaleDateString()}</li>`).join('');
    if (!datesHtml) datesHtml = '<li>None</li>';

    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 8px;"><strong>${s.roll_number}</strong><br><span style="font-size:0.75rem; color:#6b7280;">${s.name}</span></td>
        <td style="padding: 8px; text-align: center;">${s.attended_classes}/${s.total_classes}</td>
        <td style="padding: 8px; text-align: center; font-weight: bold; color: ${s.percentage < 75 ? '#ef4444' : '#059669'};">${s.percentage}%</td>
        <td style="padding: 8px;">
          <details style="font-size: 0.8rem; cursor: pointer;">
            <summary>Dates</summary>
            <ul style="padding-left: 15px; margin-top: 5px;">${datesHtml}</ul>
          </details>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <p style="font-size: 0.9rem; margin-bottom: 10px;">Total Sessions Held: <strong>${data.total_sessions}</strong></p>
    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
      <thead style="background: #f3f4f6;">
        <tr>
          <th style="padding: 8px;">Student</th>
          <th style="padding: 8px; text-align: center;">Classes</th>
          <th style="padding: 8px; text-align: center;">%</th>
          <th style="padding: 8px;">History</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
};