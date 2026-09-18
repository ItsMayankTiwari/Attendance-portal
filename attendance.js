let authToken = null; // Stores the 20-second JWT

document.getElementById('verifyIdentityBtn').onclick = async () => {
  const roll_number = document.getElementById('markRollNumber').value.trim();
  const status = document.getElementById('authStatus');
  if (!roll_number) { status.innerText = 'Enter your roll number.'; return; }

  status.innerText = 'Requesting challenge...';

  // 1. Get challenge
  const optRes = await fetch('/api/attendance-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roll_number })
  });
  const options = await optRes.json();
  if (!optRes.ok) { status.innerText = options.error; return; }

  // 2. Prompt fingerprint hardware
  let assertion;
  try {
    assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
  } catch (err) {
    status.innerText = 'Fingerprint check cancelled or failed: ' + err.message;
    return;
  }

  status.innerText = 'Verifying...';

  // 3. Verify on server and receive the 20-second token
  const verifyRes = await fetch('/api/attendance-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roll_number, response: assertion })
  });
  const result = await verifyRes.json();

  if (verifyRes.ok) {
    authToken = result.token;
    document.getElementById('authSection').style.display = 'none';
    document.getElementById('scannerSection').style.display = 'block';
    
    // In the next step, we will initialize html5-qrcode here
    console.log("Token acquired, ready to scan. Expires in 20s.", authToken);
  } else {
    status.innerText = result.error;
  }
};