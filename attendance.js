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

  // Read the raw response first instead of blindly forcing JSON
  const rawText = await verifyRes.text();
  let result;

  try {
    result = JSON.parse(rawText);
  } catch (err) {
    // If Vercel returns an HTML crash page, this catches it and prints the status code
    status.innerText = `Server crashed (Status ${verifyRes.status}). Check Vercel logs.`;
    console.error("Raw server response:", rawText);
    return;
  }

  if (verifyRes.ok) {
    authToken = result.token;
    document.getElementById('authSection').style.display = 'none';
    document.getElementById('scannerSection').style.display = 'block';

    // Initialize the camera automatically
    const html5QrCode = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    html5QrCode.start(
      { facingMode: "environment" }, // Forces the rear phone camera
      config,
      async (decodedText) => {
        // 1. Stop the camera immediately on successful read so it doesn't spam the server
        await html5QrCode.stop();
        document.getElementById('scannerSection').innerHTML = '<p>Submitting attendance...</p>';

        // 2. Send both the 20-second fingerprint proof and the 6-second QR payload
        const markRes = await fetch('/api/mark-attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auth_token: authToken,
            qr_payload: decodedText
          })
        });

        const markData = await markRes.json();
        const scannerDiv = document.getElementById('scannerSection');

        if (markRes.ok) {
          scannerDiv.innerHTML = `
            <div style="text-align: center; color: #059669;">
              <h2 style="font-size: 2rem; margin-bottom: 10px;">✅</h2>
              <p style="font-size: 1.2rem; font-weight: bold; color: #059669;">Attendance Marked!</p>
            </div>`;
        } else {
          // If the 6-second window passed, or they double-scanned, show the error
          scannerDiv.innerHTML = `
            <div style="text-align: center; color: #ef4444;">
              <h2 style="font-size: 2rem; margin-bottom: 10px;">❌</h2>
              <p style="font-weight: bold; color: #ef4444; margin-bottom: 15px;">${markData.error}</p>
              <button onclick="location.reload()" style="background-color: #ef4444;">Try Again</button>
            </div>`;
        }
      },
      (errorMessage) => {
        // This triggers constantly while the camera searches for a QR code. 
        // We safely ignore it so it doesn't flood the console.
      }
    ).catch((err) => {
      document.getElementById('scannerSection').innerHTML = `<p style="color: #ef4444;">Camera access denied or unavailable.</p>`;
    });

  } else {
    status.innerText = result.error || 'Unknown error occurred.';
  }
};