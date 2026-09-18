function getDeviceId() {
  let id = localStorage.getItem('attendance_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('attendance_device_id', id);
  }
  return id;
}

document.getElementById('registerBtn').onclick = async () => {
  const roll_number = document.getElementById('rollNumber').value.trim();
  const name = document.getElementById('studentName').value.trim();
  const status = document.getElementById('regStatus');
  if (!roll_number || !name) { status.innerText = 'Fill both fields.'; return; }

  const device_id = getDeviceId();

  const optRes = await fetch('/api/register-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roll_number, name, device_id })
  });
  const options = await optRes.json();
  if (!optRes.ok) { status.innerText = options.error; return; }

  let attResp;
  try {
    attResp = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
  } catch (err) {
    status.innerText = 'Fingerprint enrollment cancelled or failed: ' + err.message;
    return;
  }

  const verifyRes = await fetch('/api/register-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roll_number, response: attResp })
  });
  const result = await verifyRes.json();
  status.innerText = verifyRes.ok ? 'Registered! You can now mark attendance with your fingerprint.' : result.error;
};