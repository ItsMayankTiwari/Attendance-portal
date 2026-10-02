/* ==========================================================================
   attendance.js — student app logic
   ========================================================================== */

let session = null;
let profile = null;          // { name, roll_number, email, is_registered }
let recordsCache = null;     // [{course_id, course_code, course_name, percentage, attended_classes, total_classes, lectures:[{session_id,date,present}]}]
let coursesCache = [];       // [{id, course_code, course_name}]
let html5QrCode = null;
let scanTimer = null;
let editToken = null;

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('is-active'));
  document.getElementById(id).classList.add('is-active');
}

// ---------------------------------------------------------------- bootstrap

async function init() {
  const { data: { session: s } } = await supabaseClient.auth.getSession();
  session = s;

  supabaseClient.auth.onAuthStateChange((_event, newSession) => {
    const hadSession = !!session;
    session = newSession;
    if (hadSession && !newSession) location.reload();
  });

  if (session) {
    await bootDashboard();
  } else {
    show('screen-auth');
  }
}

document.getElementById('btn-google-login').onclick = async () => {
  const { error } = await googleSignIn();
  if (error) document.getElementById('auth-status').textContent = error.message;
};

document.getElementById('btn-logout').onclick = () => supabaseClient.auth.signOut();

async function bootDashboard() {
  try {
    const data = await authedFetch('/api/student-data');
    profile = data.student;
    coursesCache = data.courses || [];

    if (!profile.is_registered) { show('screen-setup'); return; }

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('is-active'));
    document.getElementById('shell').classList.remove('hidden');

    renderIdentity();
    await loadRecords();
    renderHome();
    renderProfileView();
  } catch (err) {
    document.getElementById('auth-status').textContent = err.message;
    show('screen-auth');
  }
}

function renderIdentity() {
  document.getElementById('home-avatar').textContent = initials(profile.name);
  document.getElementById('home-name').textContent = profile.name;
  document.getElementById('home-roll').textContent = profile.roll_number;
}

// ---------------------------------------------------------------- device setup

document.getElementById('btn-register-device').onclick = async () => {
  const status = document.getElementById('setup-status');
  status.textContent = 'Talking to your device…';
  try {
    let options;
    try {
      options = await authedFetch('/api/register-options', { method: 'POST' });
    } catch (err) {
      if (!err.needs_reset_verification) throw err;
      status.textContent = 'A device is already registered — verify it to replace it…';
      const stepUpOptions = await authedFetch('/api/edit-auth-options', { method: 'POST' });
      const stepUpAssertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: stepUpOptions });
      const { edit_token } = await authedFetch('/api/edit-auth-verify', {
        method: 'POST',
        body: JSON.stringify({ response: stepUpAssertion, purpose: 'reset_device' })
      });
      status.textContent = 'Verified — set up the new device…';
      options = await authedFetch('/api/register-options', { method: 'POST', body: JSON.stringify({ reset_token: edit_token }) });
    }
    const assertion = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
    await authedFetch('/api/register-verify', { method: 'POST', body: JSON.stringify({ response: assertion }) });
    await bootDashboard();
  } catch (err) {
    status.textContent = err.message || 'Could not register this device.';
  }
};

// ---------------------------------------------------------------- records + home

async function loadRecords() {
  recordsCache = await authedFetch('/api/student-records');
}

function renderHome() {
  const donutList = document.getElementById('course-donut-list');
  if (recordsCache.length === 0) {
    donutList.innerHTML = `<div class="ledger"><div class="empty-state"><div class="empty-icon">📭</div><p>Your attendance will show up here once classes begin.</p></div></div>`;
  } else {
    donutList.innerHTML = `<div class="ledger"><div class="ledger-body--flush">` + recordsCache.map(r => `
      <div class="ledger-row" style="cursor:default;">
        <div class="donut-row" style="gap:14px;">
          ${donutSVG(r.percentage, 64, 7)}
          <div class="ledger-row-title">${escapeHtml(r.course_name)}</div>
        </div>
      </div>`).join('') + `</div></div>`;
    animateDonuts(donutList);
  }

  const list = document.getElementById('course-list');
  if (coursesCache.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🎓</div><p>No courses yet — add the code your instructor shared.</p></div>`;
    return;
  }
  list.innerHTML = coursesCache.map(c => {
    const rec = recordsCache.find(r => r.course_id === c.id);
    const pct = rec ? rec.percentage : null;
    return `
      <button class="ledger-row" data-course-id="${c.id}" data-course-name="${escapeHtml(c.course_name)}">
        <div class="ledger-row-main">
          <div class="ledger-row-title">${escapeHtml(c.course_name)}</div>
          <div class="ledger-row-sub mono">${escapeHtml(c.course_code)}</div>
        </div>
        <div class="ledger-row-end">
          ${pct !== null ? `<span class="badge ${pct < 75 ? 'badge-warn' : 'badge-verified'}">${pct}%</span>` : ''}
          <span class="ledger-arrow">→</span>
        </div>
      </button>`;
  }).join('');
  list.querySelectorAll('.ledger-row').forEach(row => {
    row.onclick = () => startAttendance(row.dataset.courseId, row.dataset.courseName);
  });
}

function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// ---------------------------------------------------------------- records tab

function renderRecordsList() {
  const el = document.getElementById('records-list');
  if (recordsCache.length === 0) {
    el.innerHTML = `<div class="ledger"><div class="empty-state"><div class="empty-icon">📖</div><p>Nothing to show until your first class is recorded.</p></div></div>`;
    return;
  }
  el.innerHTML = `<div class="ledger"><div class="ledger-body--flush">` + recordsCache.map(r => `
    <button class="ledger-row" data-course-id="${r.course_id}">
      <div class="ledger-row-main">
        <div class="ledger-row-title">${escapeHtml(r.course_name)}</div>
      </div>
      <span class="ledger-arrow">→</span>
    </button>`).join('') + `</div></div>`;
  el.querySelectorAll('.ledger-row').forEach(row => row.onclick = () => openCourseDetail(row.dataset.courseId));
}

function openCourseDetail(courseId) {
  const r = recordsCache.find(x => String(x.course_id) === String(courseId));
  if (!r) return;
  document.getElementById('detail-course-name').textContent = r.course_name;
  document.getElementById('detail-course-meta').textContent = `${r.course_code} · ${r.attended_classes}/${r.total_classes} lectures`;
  document.getElementById('detail-donut').innerHTML = donutSVG(r.percentage, 96, 9);

  const lectures = (r.lectures || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const listEl = document.getElementById('detail-lecture-list');
  listEl.innerHTML = lectures.length
    ? lectures.map(l => `
        <div class="ledger-row" style="cursor:default;">
          <div class="ledger-row-main"><div class="ledger-row-title">${formatDate(l.date)}</div></div>
          <span class="badge ${l.present ? 'badge-verified' : 'badge-absent'}">
            <span class="dot ${l.present ? 'dot-verified' : 'dot-absent'}"></span>${l.present ? 'Present' : 'Absent'}
          </span>
        </div>`).join('')
    : `<div class="empty-state"><p>No lectures recorded yet.</p></div>`;

  switchView('course-detail');
  animateDonuts(document.getElementById('detail-donut'));
}

document.getElementById('btn-back-records').onclick = () => switchView('records');

// ---------------------------------------------------------------- add course

const addCourseSheet = document.getElementById('sheet-add-course');
document.getElementById('btn-add-course').onclick = () => addCourseSheet.classList.add('is-open');
document.getElementById('btn-cancel-add-course').onclick = () => addCourseSheet.classList.remove('is-open');
addCourseSheet.addEventListener('click', e => { if (e.target === addCourseSheet) addCourseSheet.classList.remove('is-open'); });

document.getElementById('btn-confirm-add-course').onclick = async () => {
  const code = document.getElementById('input-course-code').value.trim();
  if (!code) return;
  try {
    await authedFetch('/api/student-data', { method: 'POST', body: JSON.stringify({ course_code: code }) });
    document.getElementById('input-course-code').value = '';
    addCourseSheet.classList.remove('is-open');
    toast('Course added.', 'success');
    const data = await authedFetch('/api/student-data');
    coursesCache = data.courses || [];
    await loadRecords();
    renderHome();
    renderRecordsList();
  } catch (err) {
    toast(err.message, 'error');
  }
};

async function startAttendance(courseId, courseName) {
  document.getElementById('scan-course-title').textContent = courseName;
  document.getElementById('scan-verify-state').classList.add('hidden');
  document.getElementById('scan-camera-state').classList.remove('hidden');
  document.getElementById('scan-time-wrap').classList.remove('hidden');
  document.getElementById('scan-hint').classList.remove('hidden');
  document.getElementById('scan-success-state').classList.add('hidden');
  document.getElementById('scan-fail-state').classList.add('hidden');
  show('screen-scan');

  beginScanCountdown(20);

  html5QrCode = new Html5Qrcode('reader');
  html5QrCode.start(
    { facingMode: { exact: 'environment' } },
    {
      fps: 10,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.8);
        return { width: edge, height: edge };
      },
      videoConstraints: {
        facingMode: { exact: 'environment' },
        width: { min: 720, ideal: 1920 },
        height: { min: 720, ideal: 1080 }
      }
    },
    async (decodedText) => {
      clearScanCountdown();
      safeStopScanner();
      document.getElementById('scan-camera-state').classList.add('hidden');
      document.getElementById('scan-time-wrap').classList.add('hidden');
      document.getElementById('scan-hint').classList.add('hidden');
      document.getElementById('scan-verify-state').classList.remove('hidden');

      try {
        const options = await authedFetch('/api/attendance-options', { method: 'POST', body: JSON.stringify({ qr_payload: decodedText }) });
        const assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
        await authedFetch('/api/mark-attendance', { method: 'POST', body: JSON.stringify({ response: assertion, qr_payload: decodedText }) });
        document.getElementById('scan-verify-state').classList.add('hidden');
        document.getElementById('scan-success-state').classList.remove('hidden');
        await loadRecords();
        renderHome();
        renderRecordsList();
      } catch (err) {
        document.getElementById('scan-verify-state').classList.add('hidden');
        document.getElementById('scan-fail-text').textContent = err.message || 'Could not mark attendance.';
        document.getElementById('scan-fail-state').classList.remove('hidden');
      }
    },
    () => { }
  ).then(() => {
    enablePinchToZoom();
  }).catch((err) => {
    toast('Camera error: ' + (err.name || err.message || err), 'error');
    closeScan();
  });
}

// html5-qrcode's stop() throws synchronously (not just a rejected promise)
// if the scanner isn't currently running — calling it a second time (e.g.
// once from the decode/timeout handler, then again from Close) was leaving
// closeScan() half-finished, which is why Close could appear to do nothing.
function safeStopScanner() {
  if (!html5QrCode) return;
  try {
    const result = html5QrCode.stop();
    if (result && typeof result.catch === 'function') result.catch(() => { });
  } catch (e) { /* already stopped — nothing to do */ }
  html5QrCode = null;
}

// Two-finger pinch to zoom, driven directly off the camera track's own
// zoom range — no slider UI. Not every phone/browser exposes a zoom
// capability on the video track (notably iOS Safari usually doesn't); when
// it's missing this just does nothing, same as before.
let pinchState = null;
function enablePinchToZoom() {
  const reader = document.getElementById('reader');
  let zoomCaps, currentZoom;
  try {
    const capabilities = html5QrCode.getRunningTrackCapabilities();
    zoomCaps = capabilities && capabilities.zoom;
    const settings = html5QrCode.getRunningTrackSettings();
    currentZoom = (settings && settings.zoom) || (zoomCaps ? zoomCaps.min : 1);
  } catch (e) { zoomCaps = null; }
  if (!zoomCaps) return;

  const touchDistance = (touches) => Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );

  reader.ontouchstart = (e) => {
    if (e.touches.length === 2) {
      pinchState = { startDistance: touchDistance(e.touches), startZoom: currentZoom };
    }
  };
  reader.ontouchmove = (e) => {
    if (e.touches.length === 2 && pinchState) {
      e.preventDefault();
      const ratio = touchDistance(e.touches) / pinchState.startDistance;
      let next = pinchState.startZoom * ratio;
      next = Math.min(zoomCaps.max, Math.max(zoomCaps.min, next));
      currentZoom = next;
      html5QrCode.applyVideoConstraints({ advanced: [{ zoom: next }] }).catch(() => { });
    }
  };
  reader.ontouchend = () => { pinchState = null; };
}

function disablePinchToZoom() {
  const reader = document.getElementById('reader');
  if (reader) { reader.ontouchstart = null; reader.ontouchmove = null; reader.ontouchend = null; }
  pinchState = null;
}

function beginScanCountdown(seconds) {
  const timeEl = document.getElementById('scan-time');
  let remaining = seconds;
  timeEl.textContent = remaining;
  scanTimer = setInterval(() => {
    remaining -= 1;
    timeEl.textContent = Math.max(remaining, 0);
    if (remaining <= 0) {
      clearScanCountdown();
      safeStopScanner();
      document.getElementById('scan-camera-state').classList.add('hidden');
      document.getElementById('scan-time-wrap').classList.add('hidden');
      document.getElementById('scan-hint').classList.add('hidden');
      document.getElementById('scan-fail-text').textContent = 'Time ran out. Tap the course again to retry.';
      document.getElementById('scan-fail-state').classList.remove('hidden');
    }
  }, 1000);
}
function clearScanCountdown() { clearInterval(scanTimer); scanTimer = null; }

function closeScan() {
  clearScanCountdown();
  disablePinchToZoom();
  safeStopScanner();
  document.getElementById('shell').classList.remove('hidden');
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('is-active'));
}
document.getElementById('btn-scan-cancel').onclick = closeScan;
// ---------------------------------------------------------------- tabs

document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => switchView(tab.dataset.tab);
});

function switchView(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
  const map = { home: 'view-home', records: 'view-records', profile: 'view-profile', 'course-detail': 'view-course-detail' };
  document.getElementById(map[name]).classList.add('is-active');
  if (name === 'records') renderRecordsList();
}

// ---------------------------------------------------------------- profile + edit

function renderProfileView() {
  document.getElementById('profile-name').textContent = profile.name;
  document.getElementById('profile-roll').textContent = profile.roll_number;
  document.getElementById('profile-email').textContent = profile.email || '';
}

const editSheet = document.getElementById('sheet-edit-profile');
function openEditSheet() {
  editToken = null;
  document.getElementById('edit-step-verify').classList.remove('hidden');
  document.getElementById('edit-step-form').classList.add('hidden');
  document.getElementById('edit-profile-hint').textContent = 'Verify your fingerprint to continue.';
  editSheet.classList.add('is-open');
}
document.getElementById('btn-edit-profile').onclick = openEditSheet;
document.getElementById('btn-cancel-edit-1').onclick = () => editSheet.classList.remove('is-open');
document.getElementById('btn-cancel-edit-2').onclick = () => editSheet.classList.remove('is-open');
editSheet.addEventListener('click', e => { if (e.target === editSheet) editSheet.classList.remove('is-open'); });

document.getElementById('btn-edit-verify').onclick = async () => {
  const hint = document.getElementById('edit-profile-hint');
  hint.textContent = 'Waiting on fingerprint…';
  try {
    const options = await authedFetch('/api/edit-auth-options', { method: 'POST' });
    const assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
    const result = await authedFetch('/api/edit-auth-verify', { method: 'POST', body: JSON.stringify({ response: assertion }) });
    editToken = result.edit_token;
    document.getElementById('input-edit-name').value = profile.name;
    document.getElementById('input-edit-roll').value = profile.roll_number;
    document.getElementById('edit-step-verify').classList.add('hidden');
    document.getElementById('edit-step-form').classList.remove('hidden');
  } catch (err) {
    hint.textContent = err.message || 'Verification failed.';
  }
};

document.getElementById('btn-save-edit').onclick = async () => {
  const name = document.getElementById('input-edit-name').value.trim();
  const roll_number = document.getElementById('input-edit-roll').value.trim().toUpperCase();
  if (!name || !roll_number) { toast('Name and roll number are both required.', 'error'); return; }
  try {
    await authedFetch('/api/update-profile', { method: 'PATCH', body: JSON.stringify({ name, roll_number, edit_token: editToken }) });
    editSheet.classList.remove('is-open');
    toast('Profile updated.', 'success');
    const data = await authedFetch('/api/student-data');
    profile = data.student;
    renderIdentity();
    renderProfileView();
  } catch (err) {
    toast(err.message, 'error');
  }
};

init();
