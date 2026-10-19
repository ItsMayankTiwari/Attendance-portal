/* ==========================================================================
   attendance.js — student app logic
   ========================================================================== */

let session = null;
let profile = null;          // { name, roll_number, email, is_registered }
let recordsCache = [];       // [{course_id, course_code, course_name, percentage, attended_classes, total_classes, lectures:[{session_id,date,present}]}]
let coursesCache = [];       // [{id, course_code, course_name}]
let html5QrCode = null;
let scanTimer = null;
let editToken = null;
const ATTEMPT_SECONDS = 30;
let scanPhase = 'idle';
let attemptEndsAt = 0;
let activeScanCourse = null; // { id, name }
let activeDetailCourseId = null;
let activeDetailFilter = 'all';

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('is-active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('is-active');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Calculates exact classes needed to reach 75% or buffer available above 75%
function attendanceGuidance(attended, total) {
  if (!total) return { text: 'No lectures recorded yet', tone: 'neutral' };
  const pct = (attended / total) * 100;
  if (pct < 75) {
    // (attended + x) / (total + x) >= 0.75  =>  0.25x >= 0.75*total - attended  =>  x = ceil(3*total - 4*attended)
    const needed = Math.max(1, Math.ceil(3 * total - 4 * attended));
    return { text: `Attend next ${needed} class${needed === 1 ? '' : 'es'} for 75%`, tone: 'warn' };
  }
  // attended / (total + y) >= 0.75  =>  y = floor((4*attended - 3*total) / 3)
  const canMiss = Math.max(0, Math.floor((4 * attended - 3 * total) / 3));
  return {
    text: canMiss > 0 ? `On track · ${canMiss} class buffer` : 'On track · At 75% boundary',
    tone: 'verified'
  };
}

function isBelowThreshold(attended, total) {
  return total > 0 && attended / total < 0.75;
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

    if (!profile.is_registered) {
      show('screen-setup');
      return;
    }

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('is-active'));
    document.getElementById('shell').classList.remove('hidden');

    renderIdentity();
    await loadRecords();
    renderHome();
    renderRecordsList();
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
  status.textContent = 'Waiting for device passkey…';
  try {
    const options = await authedFetch('/api/register-options', { method: 'POST' });
    const assertion = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
    await authedFetch('/api/register-verify', {
      method: 'POST',
      body: JSON.stringify({ response: assertion })
    });
    toast('Biometric passkey registered successfully.', 'success');
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
  // 1. Update aggregate summary strip
  const totalAttended = recordsCache.reduce((acc, r) => acc + (r.attended_classes || 0), 0);
  const totalClasses = recordsCache.reduce((acc, r) => acc + (r.total_classes || 0), 0);
  const overallPct = totalClasses > 0 ? Math.round((totalAttended / totalClasses) * 100) : null;
  const belowCount = recordsCache.filter(r => isBelowThreshold(r.attended_classes, r.total_classes)).length;

  document.getElementById('summary-overall-pct').textContent = overallPct !== null ? `${overallPct}%` : '—';
  document.getElementById('summary-total-attended').textContent = `${totalAttended}/${totalClasses}`;
  const statusEl = document.getElementById('summary-policy-status');
  if (coursesCache.length === 0 || totalClasses === 0) {
    statusEl.textContent = 'No classes yet';
    statusEl.style.color = 'var(--text-dim)';
  } else if (belowCount > 0) {
    statusEl.textContent = `${belowCount} course${belowCount > 1 ? 's' : ''} < 75%`;
    statusEl.style.color = 'var(--warn)';
  } else {
    statusEl.textContent = 'All courses ≥ 75%';
    statusEl.style.color = 'var(--success-light)';
  }

  // 2. Render unified course ledger
  const list = document.getElementById('course-list');
  if (coursesCache.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p>No courses enrolled yet. Tap <strong>+ Add Course</strong> to enter a course code.</p>
      </div>`;
    return;
  }

  list.innerHTML = coursesCache.map(c => {
    const rec = recordsCache.find(r => String(r.course_id) === String(c.id));
    const attended = rec ? rec.attended_classes : 0;
    const total = rec ? rec.total_classes : 0;
    const pct = rec && total > 0 ? rec.percentage : null;
    const ratio = total > 0 ? attended / total : null;
    const belowThreshold = isBelowThreshold(attended, total);
    const guide = attendanceGuidance(attended, total);
    const fillClass = ratio === null ? '' : (belowThreshold ? 'is-low' : (ratio < 0.8 ? 'is-warn' : ''));

    return `
      <div class="ledger-row" data-open-course="${c.id}">
        <div class="ledger-row-main">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="mono badge badge-neutral">${escapeHtml(c.course_code)}</span>
            <span class="ledger-row-title">${escapeHtml(c.course_name)}</span>
          </div>
          <div class="ledger-row-sub" style="margin-top:2px;">
            <span class="mono">${attended}/${total} classes</span> · ${escapeHtml(guide.text)}
          </div>
          <div class="progress-track">
            <div class="progress-fill ${fillClass}" style="width: ${pct !== null ? pct : 0}%;"></div>
          </div>
        </div>
        <div class="ledger-row-end">
          ${pct !== null ? `<span class="badge ${belowThreshold ? 'badge-warn' : 'badge-verified'}">${pct}%</span>` : '<span class="badge badge-neutral">0%</span>'}
          <button class="btn btn-primary btn-sm" data-scan-course="${c.id}" data-scan-name="${escapeHtml(c.course_name)}">
            Scan QR
          </button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-scan-course]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      startAttendance(btn.dataset.scanCourse, btn.dataset.scanName);
    };
  });

  list.querySelectorAll('[data-open-course]').forEach(row => {
    row.onclick = () => openCourseDetail(row.dataset.openCourse);
  });
}

// ---------------------------------------------------------------- records tab

function renderRecordsList() {
  const el = document.getElementById('records-list');
  if (recordsCache.length === 0) {
    el.innerHTML = `<div class="ledger"><div class="empty-state"><p>Nothing to show until your first class is recorded.</p></div></div>`;
    return;
  }
  el.innerHTML = `<div class="ledger"><div class="ledger-body--flush">` + recordsCache.map(r => {
    const guide = attendanceGuidance(r.attended_classes, r.total_classes);
    return `
      <button class="ledger-row" data-course-id="${r.course_id}">
        <div class="ledger-row-main">
          <div class="ledger-row-title">${escapeHtml(r.course_name)}</div>
          <div class="ledger-row-sub"><span class="mono">${escapeHtml(r.course_code)} · ${r.attended_classes}/${r.total_classes}</span> · ${escapeHtml(guide.text)}</div>
        </div>
        <div class="ledger-row-end">
          <span class="badge ${isBelowThreshold(r.attended_classes, r.total_classes) ? 'badge-warn' : 'badge-verified'}">${r.percentage}%</span>
          <span class="ledger-arrow">→</span>
        </div>
      </button>`;
  }).join('') + `</div></div>`;
  el.querySelectorAll('.ledger-row').forEach(row => {
    row.onclick = () => openCourseDetail(row.dataset.courseId);
  });
}

function openCourseDetail(courseId) {
  const r = recordsCache.find(x => String(x.course_id) === String(courseId));
  if (!r) return;
  activeDetailCourseId = courseId;
  activeDetailFilter = 'all';

  document.querySelectorAll('#detail-filter-group .segmented-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.filter === 'all');
  });

  document.getElementById('detail-course-name').textContent = r.course_name;
  document.getElementById('detail-course-meta').textContent = `${r.course_code} · ${r.attended_classes}/${r.total_classes} lectures (${r.percentage}%)`;
  const guide = attendanceGuidance(r.attended_classes, r.total_classes);
  const guideEl = document.getElementById('detail-course-guidance');
  guideEl.textContent = guide.text;
  guideEl.style.color = guide.tone === 'warn' ? 'var(--warn)' : 'var(--success-light)';

  document.getElementById('detail-donut').innerHTML = donutSVG(r.percentage, 88, 9);
  document.getElementById('btn-detail-scan').onclick = () => startAttendance(r.course_id, r.course_name);

  renderDetailLectures();
  switchView('course-detail');
  animateDonuts(document.getElementById('detail-donut'));
}

function renderDetailLectures() {
  const r = recordsCache.find(x => String(x.course_id) === String(activeDetailCourseId));
  if (!r) return;
  const allLectures = (r.lectures || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const filtered = allLectures.filter(l => {
    if (activeDetailFilter === 'present') return l.present;
    if (activeDetailFilter === 'absent') return !l.present;
    return true;
  });

  const listEl = document.getElementById('detail-lecture-list');
  listEl.innerHTML = filtered.length
    ? filtered.map((l, idx) => `
        <div class="ledger-row" style="cursor:default;">
          <div class="ledger-row-main">
            <div class="ledger-row-title">${formatDate(l.date)}</div>
            <div class="ledger-row-sub mono">${formatTime(l.date)} · Session #${allLectures.length - allLectures.indexOf(l)}</div>
          </div>
          <span class="badge ${l.present ? 'badge-verified' : 'badge-absent'}">
            ${l.present ? 'Present' : 'Absent'}
          </span>
        </div>`).join('')
    : `<div class="empty-state"><p>No matching lectures for this filter.</p></div>`;
}

document.querySelectorAll('#detail-filter-group .segmented-btn').forEach(btn => {
  btn.onclick = () => {
    activeDetailFilter = btn.dataset.filter;
    document.querySelectorAll('#detail-filter-group .segmented-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.filter === activeDetailFilter);
    });
    renderDetailLectures();
  };
});

document.getElementById('btn-back-records').onclick = () => switchView('records');

// ---------------------------------------------------------------- add course

const addCourseSheet = document.getElementById('sheet-add-course');
document.getElementById('btn-add-course').onclick = () => {
  addCourseSheet.classList.add('is-open');
  setTimeout(() => document.getElementById('input-course-code').focus(), 50);
};
document.getElementById('btn-cancel-add-course').onclick = () => addCourseSheet.classList.remove('is-open');
addCourseSheet.addEventListener('click', e => { if (e.target === addCourseSheet) addCourseSheet.classList.remove('is-open'); });

document.getElementById('btn-confirm-add-course').onclick = async () => {
  const code = document.getElementById('input-course-code').value.trim().toUpperCase();
  if (!code) { toast('Enter a course code.', 'error'); return; }
  try {
    await authedFetch('/api/student-data', { method: 'POST', body: JSON.stringify({ course_code: code }) });
    document.getElementById('input-course-code').value = '';
    addCourseSheet.classList.remove('is-open');
    toast(`Enrolled in ${code}.`, 'success');
    const data = await authedFetch('/api/student-data');
    coursesCache = data.courses || [];
    await loadRecords();
    renderHome();
    renderRecordsList();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ---------------------------------------------------------------- QR scanner + WebAuthn + GPS

function beginAttemptCountdown() {
  const timeEl = document.getElementById('scan-time');
  attemptEndsAt = Date.now() + ATTEMPT_SECONDS * 1000;
  clearScanCountdown();
  const tick = () => {
    const left = Math.max(0, Math.ceil((attemptEndsAt - Date.now()) / 1000));
    timeEl.textContent = left;
    if (left <= 0) onAttemptTimeout();
  };
  tick();
  scanTimer = setInterval(tick, 250);
}

function cancelFingerprintPrompt() {
  try { SimpleWebAuthnBrowser.WebAuthnAbortService.cancelCeremony(); } catch (e) { }
}

function showScanFail(msg) {
  ['scan-camera-state', 'scan-time-wrap', 'scan-hint', 'scan-verify-state']
    .forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('scan-fail-text').textContent = msg;
  document.getElementById('scan-fail-state').classList.remove('hidden');
}

function onAttemptTimeout() {
  if (scanPhase === 'done') return;
  scanPhase = 'done';
  clearScanCountdown();
  safeStopScanner();
  cancelFingerprintPrompt();
  showScanFail('30-second window expired. Tap Try Again to rescan.');
}

function getLocationAsync() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('Geolocation is not supported by this browser.'));
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) => {
        if (e && e.code === 1) {
          reject(new Error('Location permission denied. Enable GPS access in browser settings and retry.'));
        } else {
          reject(new Error('Could not acquire GPS fix. Ensure Location Services are enabled and retry.'));
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

async function startAttendance(courseId, courseName) {
  if (typeof Html5Qrcode === 'undefined') {
    toast('Scanner library failed to load. Reload the page.', 'error');
    return;
  }
  safeStopScanner();
  activeScanCourse = { id: courseId, name: courseName };

  document.getElementById('scan-course-title').textContent = courseName;
  document.getElementById('scan-verify-state').classList.add('hidden');
  document.getElementById('scan-camera-state').classList.remove('hidden');
  document.getElementById('scan-time-wrap').classList.remove('hidden');
  document.getElementById('scan-hint').classList.remove('hidden');
  document.getElementById('scan-success-state').classList.add('hidden');
  document.getElementById('scan-fail-state').classList.add('hidden');
  show('screen-scan');

  scanPhase = 'scanning';
  beginAttemptCountdown();

  html5QrCode = new Html5Qrcode('reader');
  html5QrCode.start(
    { facingMode: 'environment' },
    {
      fps: 12,
      qrbox: (w, h) => { const e = Math.floor(Math.min(w, h) * 0.78); return { width: e, height: e }; }
    },
    async (decodedText) => {
      if (scanPhase !== 'scanning') return;
      scanPhase = 'verifying';
      safeStopScanner();
      document.getElementById('scan-camera-state').classList.add('hidden');
      document.getElementById('scan-hint').classList.add('hidden');
      document.getElementById('scan-verify-state').classList.remove('hidden');

      const gpsPromise = getLocationAsync().then(
        (location) => ({ location }),
        (error) => ({ error })
      );

      try {
        const options = await authedFetch('/api/attendance-options', {
          method: 'POST',
          body: JSON.stringify({ qr_payload: decodedText, expected_course_id: courseId })
        });
        if (scanPhase !== 'verifying') return;
        const assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
        if (scanPhase !== 'verifying') return;

        const gpsResult = await gpsPromise;
        if (gpsResult.error) throw gpsResult.error;
        const { latitude, longitude } = gpsResult.location;

        await authedFetch('/api/mark-attendance', {
          method: 'POST',
          body: JSON.stringify({
            response: assertion,
            qr_payload: decodedText,
            latitude,
            longitude,
            expected_course_id: courseId
          })
        });
        scanPhase = 'done';
        clearScanCountdown();
        document.getElementById('scan-time-wrap').classList.add('hidden');
        document.getElementById('scan-verify-state').classList.add('hidden');
        document.getElementById('scan-fail-state').classList.add('hidden');
        document.getElementById('scan-success-state').classList.remove('hidden');
        await loadRecords();
        renderHome();
        renderRecordsList();
        if (activeDetailCourseId) renderDetailLectures();
        setTimeout(() => {
          if (scanPhase === 'done') closeScan();
        }, 1600);
      } catch (err) {
        if (scanPhase === 'done') return;
        scanPhase = 'done';
        clearScanCountdown();
        showScanFail(err.message || 'Could not mark attendance.');
      }
    },
    () => { }
  ).then(() => {
    if (scanPhase !== 'scanning') {
      safeStopScanner();
      return;
    }
    enablePinchToZoom();
  }).catch((err) => {
    showScanFail('Camera error: ' + (err.name || err.message || err));
  });
}

document.getElementById('btn-scan-retry').onclick = () => {
  if (activeScanCourse) {
    startAttendance(activeScanCourse.id, activeScanCourse.name);
  }
};

function safeStopScanner() {
  if (!html5QrCode) return;
  try {
    const result = html5QrCode.stop();
    if (result && typeof result.catch === 'function') result.catch(() => { });
  } catch (e) { }
  html5QrCode = null;
}

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

function clearScanCountdown() { clearInterval(scanTimer); scanTimer = null; }

function closeScan() {
  scanPhase = 'done';
  cancelFingerprintPrompt();
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
  const target = document.getElementById(map[name]);
  if (target) target.classList.add('is-active');
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
  document.getElementById('edit-profile-hint').textContent = 'Verify your passkey to unlock profile editing.';
  editSheet.classList.add('is-open');
}
document.getElementById('btn-edit-profile').onclick = openEditSheet;
document.getElementById('btn-cancel-edit-1').onclick = () => editSheet.classList.remove('is-open');
document.getElementById('btn-cancel-edit-2').onclick = () => editSheet.classList.remove('is-open');
editSheet.addEventListener('click', e => { if (e.target === editSheet) editSheet.classList.remove('is-open'); });

document.getElementById('btn-edit-verify').onclick = async () => {
  const hint = document.getElementById('edit-profile-hint');
  hint.textContent = 'Waiting for biometric confirmation…';
  try {
    const options = await authedFetch('/api/edit-auth-options', { method: 'POST' });
    const assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
    const result = await authedFetch('/api/edit-auth-verify', {
      method: 'POST',
      body: JSON.stringify({ response: assertion, purpose: 'edit_profile' })
    });
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
  if (!name) { toast('Name is required.', 'error'); return; }
  try {
    await authedFetch('/api/update-profile', {
      method: 'PATCH',
      body: JSON.stringify({ name, edit_token: editToken })
    });
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
