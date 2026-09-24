// Initialize Supabase Client (Paste your actual URL and Anon Key here)
const SUPABASE_URL = 'https://fdjbmnpqyzsxwwgavhnd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkamJtbnBxeXpzeHd3Z2F2aG5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4NDcsImV4cCI6MjEwMzA0Nzg0N30.VxyBjad4MtjgV8uWboBimvmWBkpku4GTKj41O7QxLYg';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let sessionId = null;
let pollTimer = null;
let realtimeSubscription = null;
let scanCount = 0;

document.getElementById('startBtn').onclick = async () => {
  const course_code = document.getElementById('courseCode').value.trim();
  
  const res = await fetch('/api/start-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ course_code })
  });

  // Prevent silent JSON crashes if the server returns a 500 error page
  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    alert(`Server crashed starting session (Status ${res.status}). Check Vercel logs.`);
    console.error("Raw response:", rawText);
    return;
  }

  if (!res.ok) { alert(data.error); return; }

  sessionId = data.session_id;
  document.getElementById('startSection').style.display = 'none';
  document.getElementById('qrSection').style.display = 'block';
  
  scanCount = 0;
  document.getElementById('scanCount').innerText = scanCount;
  
  refreshQR();
  setupRealtimeListener(sessionId);
};

function setupRealtimeListener(currentSessionId) {
  // Listen for new rows added to attendance_records for this specific session
  realtimeSubscription = supabaseClient
    .channel('attendance_channel')
    .on('postgres_changes', { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'attendance_records',
      filter: `session_id=eq.${currentSessionId}`
    }, payload => {
      scanCount++;
      document.getElementById('scanCount').innerText = scanCount;
    })
    .subscribe();
}

async function refreshQR() {
  const res = await fetch(`/api/qr-token?session_id=${sessionId}`);
  
  // Read raw text first to prevent silent JSON crashes
  const rawText = await res.text();
  let data;
  const status = document.getElementById('qrStatus');

  try {
    data = JSON.parse(rawText);
  } catch (err) {
    status.innerText = `Server crashed (Status ${res.status}). Check Vercel logs.`;
    console.error("Raw response:", rawText);
    clearInterval(pollTimer);
    return;
  }
  
  if (!res.ok) {
    status.innerText = data.error;
    clearInterval(pollTimer);
    return;
  }
  
  status.innerText = ''; // clear errors
  QRCode.toCanvas(document.getElementById('qrCanvas'), data.payload, { width: 320 }, (err) => {
    if (err) console.error(err);
  });
  
  if (!pollTimer) pollTimer = setInterval(refreshQR, data.rotation_seconds * 1000);
}

document.getElementById('endBtn').onclick = async () => {
  await fetch('/api/end-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId })
  });
  
  // Clean up loops and listeners
  clearInterval(pollTimer);
  pollTimer = null;
  if (realtimeSubscription) {
    supabaseClient.removeChannel(realtimeSubscription);
  }
  
  document.getElementById('qrSection').style.display = 'none';
  document.getElementById('startSection').style.display = 'block';
};