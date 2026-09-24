let sessionId = null;
let pollTimer = null;

document.getElementById('startBtn').onclick = async () => {
  const course_code = document.getElementById('courseCode').value.trim();
  const res = await fetch('/api/start-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ course_code })
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error); return; }

  sessionId = data.session_id;
  document.getElementById('startSection').style.display = 'none';
  document.getElementById('qrSection').style.display = 'block';
  refreshQR();
};

async function refreshQR() {
  const res = await fetch(`/api/qr-token?session_id=${sessionId}`);
  const data = await res.json();
  const status = document.getElementById('qrStatus');
  if (!res.ok) {
    status.innerText = data.error;
    clearInterval(pollTimer);
    return;
  }
  console.log('Current QR payload:', data.payload); // handy for manual testing this week
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
  clearInterval(pollTimer);
  pollTimer = null;
  document.getElementById('qrSection').style.display = 'none';
  document.getElementById('startSection').style.display = 'block';
};