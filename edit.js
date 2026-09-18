let currentStudentId = null;

document.getElementById('editAuthBtn').onclick = async () => {
  const status = document.getElementById('editStatus');
  const optRes = await fetch('/api/edit-auth-options', { method: 'POST' });
  const options = await optRes.json();

  let assertion;
  try {
    assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
  } catch (err) {
    status.innerText = 'Fingerprint check cancelled or failed.' + err.message;
    return;
  }

  const verifyRes = await fetch('/api/edit-auth-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: assertion })
  });
  const result = await verifyRes.json();
  if (!verifyRes.ok) { status.innerText = result.error; return; }

  currentStudentId = result.student_id;
  document.getElementById('editName').value = result.name;
  document.getElementById('editRoll').value = result.roll_number;
  document.getElementById('editForm').style.display = 'block';
};

document.getElementById('saveBtn').onclick = async () => {
  const status = document.getElementById('editStatus');
  const res = await fetch('/api/update-profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      student_id: currentStudentId,
      name: document.getElementById('editName').value.trim(),
      roll_number: document.getElementById('editRoll').value.trim()
    })
  });
  const result = await res.json();
  status.innerText = res.ok ? 'Updated!' : result.error;
};