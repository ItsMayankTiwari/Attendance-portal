/* ==========================================================================
   teacher.js — instructor console logic
   ========================================================================== */

let session = null;
let courses = [];
let selectedCourseId = null;
let courseDataCache = null; // { total_sessions, sessions:[{id,session_date}], stats:[...] }

let activeSessionId = null;
let qrTimer = null;
let pollInterval = null;
let liveQrCodeInstance = null;

let rosterFilter = 'all';
let rosterSearchQuery = '';
let gridSearchQuery = '';

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function isBelowThreshold(student) {
  return student.total_classes > 0 && student.attended_classes / student.total_classes < 0.75;
}

// ---------------------------------------------------------------- bootstrap

async function init() {
  const { data: { session: s } } = await supabaseClient.auth.getSession();
  session = s;

  supabaseClient.auth.onAuthStateChange((_event, newSession) => {
    const had = !!session;
    session = newSession;
    if (had && !newSession) location.reload();
  });

  if (session) {
    await bootConsole();
  } else {
    document.getElementById('screen-loading').classList.remove('is-active');
    document.getElementById('screen-auth').classList.add('is-active');
  }
}

document.getElementById('btn-google-login').onclick = async () => {
  const { error } = await googleSignIn();
  if (error) document.getElementById('auth-status').textContent = error.message;
};
document.getElementById('btn-logout').onclick = () => supabaseClient.auth.signOut();

async function bootConsole() {
  try {
    courses = await authedFetch('/api/teacher-courses');
  } catch (err) {
    document.getElementById('screen-loading').classList.remove('is-active');
    document.getElementById('screen-auth').classList.add('is-active');
    document.getElementById('auth-status').textContent = err.message;
    return;
  }
  document.getElementById('screen-loading').classList.remove('is-active');
  document.getElementById('screen-auth').classList.remove('is-active');
  document.getElementById('shell').classList.remove('hidden');
  document.getElementById('user-badge').textContent = session.user.email;

  populateCourseSelect();
  renderCoursesManageList();
  if (courses.length > 0) {
    selectedCourseId = courses[0].id;
    document.getElementById('course-select').value = selectedCourseId;
    await loadCourseData();
  } else {
    showEmptyStates();
  }
}

function populateCourseSelect() {
  const sel = document.getElementById('course-select');
  sel.innerHTML = courses.map(c => `<option value="${c.id}">${escapeHtml(c.course_code)} — ${escapeHtml(c.course_name)}</option>`).join('')
    || '<option value="">No courses yet</option>';
  sel.onchange = async () => {
    selectedCourseId = sel.value;
    if (activeSessionId) stopLiveLocally();
    await loadCourseData();
  };
}

// ---------------------------------------------------------------- nav

document.querySelectorAll('.navrail-item[data-view]').forEach(btn => {
  btn.onclick = () => switchView(btn.dataset.view);
});

const titles = {
  overview: 'Class Overview',
  grid: 'Attendance Sheet',
  live: 'Live Session',
  map: 'Location Map',
  courses: 'Manage Courses'
};

function switchView(name) {
  document.querySelectorAll('.navrail-item[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
  document.querySelectorAll('.teacher-view').forEach(v => v.classList.remove('is-active'));
  document.getElementById('tview-' + name).classList.add('is-active');
  document.getElementById('page-title').textContent = titles[name];
  document.getElementById('course-select').style.visibility = name === 'courses' ? 'hidden' : 'visible';
  if (name === 'live') renderLiveView();
  if (name === 'map') {
    loadLocationMap(true);
    setTimeout(() => locMap && locMap.invalidateSize(), 150);
  }
}

function showEmptyStates() {
  document.getElementById('overview-empty').classList.remove('hidden');
  document.getElementById('overview-content').classList.add('hidden');
  document.getElementById('grid-empty').classList.remove('hidden');
  document.getElementById('grid-content').classList.add('hidden');
}

// ---------------------------------------------------------------- course data

async function loadCourseData() {
  if (!selectedCourseId) { showEmptyStates(); return; }
  try {
    courseDataCache = await authedFetch(`/api/teacher-records?course_id=${selectedCourseId}`);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  renderOverview();
  renderGrid();
  locData = null;
  if (document.getElementById('tview-map').classList.contains('is-active')) loadLocationMap();
}

function renderOverview() {
  const { total_sessions, stats } = courseDataCache;
  document.getElementById('overview-empty').classList.add('hidden');
  document.getElementById('overview-content').classList.remove('hidden');
  document.getElementById('overview-session-count').textContent = `${total_sessions} lecture${total_sessions === 1 ? '' : 's'} held`;

  const avgPct = stats.length ? Math.round(stats.reduce((a, s) => a + s.percentage, 0) / stats.length) : 0;
  document.getElementById('overview-donut').innerHTML = donutSVG(avgPct, 96, 10);
  animateDonuts(document.getElementById('overview-donut'));
  document.getElementById('overview-avg').textContent = avgPct + '%';

  const atRisk = stats.filter(s => total_sessions > 0 && isBelowThreshold(s))
    .sort((a, b) => a.attended_classes / a.total_classes - b.attended_classes / b.total_classes);
  document.getElementById('overview-at-risk-count').textContent = atRisk.length;

  const panel = document.getElementById('at-risk-panel');
  if (atRisk.length === 0) {
    panel.innerHTML = `
      <div class="ledger-head"><h3>Below 75% Threshold</h3><span class="meta">0 students</span></div>
      <div class="empty-state"><p>All enrolled students meet or exceed the 75% attendance requirement.</p></div>`;
  } else {
    panel.innerHTML = `
      <div class="ledger-head"><h3>Below 75% Threshold</h3><span class="meta">${atRisk.length} student${atRisk.length === 1 ? '' : 's'}</span></div>
      <div class="ledger-body--flush">` + atRisk.map(s => `
        <div class="ledger-row" style="cursor:default;">
          <div class="ledger-row-main">
            <div class="ledger-row-title">${escapeHtml(s.name)}</div>
            <div class="ledger-row-sub mono">${escapeHtml(s.roll_number)} · ${s.attended_classes}/${s.total_classes}</div>
          </div>
          <span class="badge badge-warn">${s.percentage}%</span>
        </div>`).join('') + `</div>`;
  }

  renderRosterTable();
}

function renderRosterTable() {
  if (!courseDataCache) return;
  const { total_sessions, stats } = courseDataCache;
  const q = rosterSearchQuery.trim().toLowerCase();

  const filtered = stats.slice()
    .sort((a, b) => a.roll_number.localeCompare(b.roll_number))
    .filter(s => {
      if (rosterFilter === 'risk' && (total_sessions === 0 || !isBelowThreshold(s))) return false;
      if (!q) return true;
      return s.roll_number.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q);
    });

  document.getElementById('roster-count-badge').textContent = `${filtered.length} of ${stats.length} students`;

  const tbody = document.getElementById('roster-table-body');
  tbody.innerHTML = filtered.map(s => `
    <tr>
      <td class="mono" style="font-weight: 600;">${escapeHtml(s.roll_number)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td class="num">${s.attended_classes}/${s.total_classes}</td>
      <td class="num"><span class="badge ${total_sessions > 0 && isBelowThreshold(s) ? 'badge-warn' : 'badge-verified'}">${s.percentage}%</span></td>
      <td class="num"><button class="link-btn" data-remove-student="${escapeHtml(s.roll_number)}" style="color:var(--absent-strong);">Unenroll</button></td>
    </tr>`).join('') || `<tr><td colspan="5" class="text-dim" style="text-align:center; padding:24px;">No matching students found.</td></tr>`;

  tbody.querySelectorAll('[data-remove-student]').forEach(btn => {
    btn.onclick = async () => {
      const roll_number = btn.dataset.removeStudent;
      const ok = await confirmSheet({
        title: 'Unenroll this student?',
        body: `${roll_number} will be removed from this course roster. Past attendance records remain in the database.`,
        confirmLabel: 'Unenroll',
        danger: true
      });
      if (!ok) return;
      try {
        await authedFetch('/api/remove-enrollment', {
          method: 'POST',
          body: JSON.stringify({ course_id: selectedCourseId, roll_number })
        });
        toast(`${roll_number} unenrolled.`, 'success');
        await loadCourseData();
      } catch (err) { toast(err.message, 'error'); }
    };
  });
}

document.getElementById('roster-search').oninput = (e) => {
  rosterSearchQuery = e.target.value;
  renderRosterTable();
};

document.querySelectorAll('#roster-filter-group .segmented-btn').forEach(btn => {
  btn.onclick = () => {
    rosterFilter = btn.dataset.rfilter;
    document.querySelectorAll('#roster-filter-group .segmented-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.rfilter === rosterFilter);
    });
    renderRosterTable();
  };
});

document.getElementById('btn-export-csv').onclick = () => {
  if (!courseDataCache) return;
  const course = courses.find(c => String(c.id) === String(selectedCourseId));
  const rows = [['Roll Number', 'Name', 'Attended', 'Total', 'Percentage']];
  courseDataCache.stats.forEach(s => rows.push([s.roll_number, s.name, s.attended_classes, s.total_classes, s.percentage + '%']));
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const csv = rows.map(r => r.map(cell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${course ? course.course_code : 'course'}-attendance.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------------------------------------------------------------- lecture grid + click-to-toggle

document.getElementById('btn-grid-mark').onclick = () => submitManualAttendance('add');
document.getElementById('btn-grid-unmark').onclick = () => submitManualAttendance('remove');

async function submitManualAttendance(action) {
  const session_id = document.getElementById('grid-session-select').value;
  const input = document.getElementById('grid-manual-roll');
  const roll_number = input.value.trim().toUpperCase();
  if (!session_id) { toast('Select a lecture session first.', 'error'); return; }
  if (!roll_number) { toast('Enter a student roll number.', 'error'); return; }
  await toggleStudentSessionAttendance(session_id, roll_number, action);
  input.value = '';
}

async function toggleStudentSessionAttendance(session_id, roll_number, action) {
  try {
    const data = await authedFetch('/api/add-attendance-manual', {
      method: 'POST',
      body: JSON.stringify({ session_id, roll_number, action })
    });
    toast(action === 'remove' ? `${data.roll_number} marked absent.` : `${data.roll_number} marked present.`, 'success');
    await loadCourseData();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('grid-search-input').oninput = (e) => {
  gridSearchQuery = e.target.value;
  renderGridTableOnly();
};

function renderGrid() {
  const { sessions, stats } = courseDataCache;
  if (!sessions || sessions.length === 0) {
    document.getElementById('grid-empty').classList.remove('hidden');
    document.getElementById('grid-content').classList.add('hidden');
    return;
  }
  document.getElementById('grid-empty').classList.add('hidden');
  document.getElementById('grid-content').classList.remove('hidden');

  const sorted = sessions.slice().sort((a, b) => new Date(a.session_date) - new Date(b.session_date));
  const sel = document.getElementById('grid-session-select');
  const prevSelected = sel.value;
  const mostRecentFirst = sorted.slice().reverse();
  sel.innerHTML = mostRecentFirst.map(s => `<option value="${s.id}">${formatDate(s.session_date)} (${formatTime(s.session_date)})</option>`).join('');
  if (prevSelected && sorted.some(s => String(s.id) === String(prevSelected))) {
    sel.value = prevSelected;
  }

  // Populate autocomplete datalist for roll numbers
  const dl = document.getElementById('enrolled-rolls-datalist');
  if (dl) {
    dl.innerHTML = stats.map(s => `<option value="${escapeHtml(s.roll_number)}">${escapeHtml(s.name)}</option>`).join('');
  }

  renderGridTableOnly();
}

function renderGridTableOnly() {
  if (!courseDataCache || !courseDataCache.sessions) return;
  const { sessions, stats } = courseDataCache;
  const sorted = sessions.slice().sort((a, b) => new Date(a.session_date) - new Date(b.session_date));
  const q = gridSearchQuery.trim().toLowerCase();

  const filteredStats = stats.slice()
    .sort((a, b) => a.roll_number.localeCompare(b.roll_number))
    .filter(s => !q || s.roll_number.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q));

  const head = `<thead><tr><th>Roll No.</th>${sorted.map(s => `<th title="${escapeHtml(formatDate(s.session_date))}">${formatDate(s.session_date).slice(0, 6)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>` + (filteredStats.map(s => {
    const present = new Set(s.present_session_ids || []);
    return `<tr>
      <td title="${escapeHtml(s.name)}">${escapeHtml(s.roll_number)}</td>
      ${sorted.map(sess => {
        const isPresent = present.has(sess.id);
        return `<td>
          <button type="button"
            class="grid-mark ${isPresent ? 'present' : 'absent'}"
            data-toggle-session="${sess.id}"
            data-toggle-roll="${escapeHtml(s.roll_number)}"
            data-toggle-action="${isPresent ? 'remove' : 'add'}"
            title="${escapeHtml(s.roll_number)} · ${formatDate(sess.session_date)}: Click to mark${isPresent ? 'absent' : 'present'}">
            ${isPresent ? '✓' : '·'}
          </button>
        </td>`;
      }).join('')}
    </tr>`;
  }).join('') || `<tr><td colspan="${sorted.length + 1}" class="text-dim" style="text-align:center; padding:20px;">No matching students.</td></tr>`) + `</tbody>`;

  const tableEl = document.getElementById('lecture-grid-table');
  tableEl.innerHTML = head + body;

  tableEl.querySelectorAll('[data-toggle-session]').forEach(btn => {
    btn.onclick = () => {
      btn.disabled = true;
      toggleStudentSessionAttendance(
        btn.dataset.toggleSession,
        btn.dataset.toggleRoll,
        btn.dataset.toggleAction
      );
    };
  });
}

// ---------------------------------------------------------------- manage courses & roll number fix

document.getElementById('btn-create-course').onclick = async () => {
  const course_code = document.getElementById('input-new-code').value.trim().toUpperCase();
  const course_name = document.getElementById('input-new-name').value.trim();
  if (!course_code || !course_name) { toast('Enter both a course code and title.', 'error'); return; }
  try {
    await authedFetch('/api/teacher-courses', {
      method: 'POST',
      body: JSON.stringify({ action: 'create_course', course_code, course_name })
    });
    document.getElementById('input-new-code').value = '';
    document.getElementById('input-new-name').value = '';
    toast(`Course ${course_code} created.`, 'success');
    courses = await authedFetch('/api/teacher-courses');
    populateCourseSelect();
    renderCoursesManageList();
    if (!selectedCourseId && courses.length > 0) {
      selectedCourseId = courses[0].id;
      document.getElementById('course-select').value = selectedCourseId;
      await loadCourseData();
    }
  } catch (err) { toast(err.message, 'error'); }
};

document.getElementById('btn-fix-roll').onclick = async () => {
  const student_email = document.getElementById('input-fix-email').value.trim().toLowerCase();
  const new_roll_number = document.getElementById('input-fix-roll').value.trim().toUpperCase();
  if (!student_email || !new_roll_number) {
    toast('Enter both the student email and corrected roll number.', 'error');
    return;
  }
  try {
    await authedFetch('/api/fix-roll-number', {
      method: 'POST',
      body: JSON.stringify({ student_email, new_roll_number })
    });
    document.getElementById('input-fix-email').value = '';
    document.getElementById('input-fix-roll').value = '';
    toast(`Updated roll number to ${new_roll_number}.`, 'success');
    if (selectedCourseId) await loadCourseData();
  } catch (err) {
    toast(err.message, 'error');
  }
};

function renderCoursesManageList() {
  const el = document.getElementById('courses-manage-list');
  el.innerHTML = courses.length ? courses.map(c => `
    <div class="ledger-row ledger-row--stack">
      <div class="spread">
        <div class="ledger-row-main">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="mono badge badge-neutral">${escapeHtml(c.course_code)}</span>
            <span class="ledger-row-title">${escapeHtml(c.course_name)}</span>
          </div>
          <div class="ledger-row-sub mono" style="margin-top:2px;">Role: ${escapeHtml(c.user_role)}</div>
        </div>
        ${c.user_role === 'INSTRUCTOR' ? `<button class="btn btn-danger btn-sm" data-del="${c.id}">Delete Course</button>` : ''}
      </div>
      ${c.user_role === 'INSTRUCTOR' ? `
        <div class="ta-manage-block">
          <div class="ta-manage-label">Teaching Assistants (TAs)</div>
          <div class="ta-chip-row">
            ${(c.tas || []).map(ta => `
              <span class="ta-chip">
                ${escapeHtml(ta.email)}
                <button class="ta-chip-remove" title="Remove TA" data-rm-ta="${c.id}|${escapeHtml(ta.email)}">×</button>
              </span>`).join('') || '<span class="text-dim" style="font-size:0.8rem;">No TAs assigned yet</span>'}
          </div>
          <div class="ta-add-row">
            <input class="input input-paper mono" data-ta-input="${c.id}" placeholder="ta_email@iitj.ac.in" style="max-width: 260px;">
            <button class="btn btn-ghost-paper btn-sm" data-add-ta="${c.id}">+ Assign TA</button>
          </div>
        </div>` : ''}
    </div>`).join('') : `<div class="empty-state"><p>No courses created yet.</p></div>`;

  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      const course = courses.find(c => String(c.id) === btn.dataset.del);
      const ok = await confirmSheet({
        title: `Delete ${course.course_code}?`,
        body: `This permanently deletes ${course.course_code} (${course.course_name}) along with all sessions and attendance records.`,
        confirmLabel: 'Delete course',
        danger: true
      });
      if (!ok) return;
      try {
        await authedFetch('/api/teacher-courses', {
          method: 'POST',
          body: JSON.stringify({ action: 'delete_course', course_id: course.id })
        });
        toast('Course deleted.', 'success');
        courses = await authedFetch('/api/teacher-courses');
        populateCourseSelect();
        renderCoursesManageList();
        if (String(selectedCourseId) === String(course.id)) {
          selectedCourseId = courses[0]?.id || null;
          if (selectedCourseId) document.getElementById('course-select').value = selectedCourseId;
          await loadCourseData();
        }
      } catch (err) { toast(err.message, 'error'); }
    };
  });

  el.querySelectorAll('[data-add-ta]').forEach(btn => {
    btn.onclick = async () => {
      const course_id = btn.dataset.addTa;
      const input = el.querySelector(`[data-ta-input="${course_id}"]`);
      const ta_email = input.value.trim();
      if (!ta_email) { toast('Enter a TA @iitj.ac.in email.', 'error'); return; }
      try {
        await authedFetch('/api/manage-ta', {
          method: 'POST',
          body: JSON.stringify({ action: 'add', course_id, ta_email })
        });
        toast('TA assigned.', 'success');
        courses = await authedFetch('/api/teacher-courses');
        renderCoursesManageList();
      } catch (err) { toast(err.message, 'error'); }
    };
  });

  el.querySelectorAll('[data-rm-ta]').forEach(btn => {
    btn.onclick = async () => {
      const [course_id, ta_email] = btn.dataset.rmTa.split('|');
      const ok = await confirmSheet({
        title: 'Remove this TA?',
        body: `${ta_email} will no longer be able to run live sessions or manage attendance for this course.`,
        confirmLabel: 'Remove TA',
        danger: true
      });
      if (!ok) return;
      try {
        await authedFetch('/api/manage-ta', {
          method: 'POST',
          body: JSON.stringify({ action: 'remove', course_id, ta_email })
        });
        toast('TA removed.', 'success');
        courses = await authedFetch('/api/teacher-courses');
        renderCoursesManageList();
      } catch (err) { toast(err.message, 'error'); }
    };
  });
}

// ---------------------------------------------------------------- live session

function renderLiveView() {
  document.getElementById('live-idle').classList.toggle('hidden', !!activeSessionId);
  document.getElementById('live-active').classList.toggle('hidden', !activeSessionId);
}

function stopLiveLocally() {
  clearTimeout(qrTimer); qrTimer = null;
  clearInterval(pollInterval); pollInterval = null;
  activeSessionId = null;
  renderLiveView();
}

document.getElementById('btn-start-session').onclick = async () => {
  if (!selectedCourseId) { toast('Select a course first.', 'error'); return; }
  try {
    const data = await authedFetch('/api/start-session', {
      method: 'POST',
      body: JSON.stringify({ course_id: selectedCourseId })
    });
    activeSessionId = data.session_id;
    document.getElementById('qr-refresh-interval').textContent = data.rotation_seconds || 4;
    if (data.resumed) toast('Resumed active session for this course.', 'success');

    document.getElementById('live-count').textContent = '0';
    renderLiveView();
    clearTimeout(qrTimer); clearInterval(pollInterval);
    refreshQr();
    pollInterval = setInterval(refreshLiveRoster, 3000);
    refreshLiveRoster();
  } catch (err) { toast(err.message, 'error'); }
};

function animateQrProgressBar(durationMs) {
  const fill = document.getElementById('qr-progress-fill');
  if (!fill) return;
  fill.style.transition = 'none';
  fill.style.transform = 'scaleX(1)';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fill.style.transition = `transform ${durationMs}ms linear`;
      fill.style.transform = 'scaleX(0)';
    });
  });
}

async function refreshQr() {
  if (!activeSessionId) return;
  let waitMs = 1000;
  try {
    const data = await authedFetch(`/api/session-qr?session_id=${encodeURIComponent(activeSessionId)}`);
    const box = document.getElementById('qr-box');
    box.innerHTML = '';
    liveQrCodeInstance = new QRCode(box, {
      text: data.payload,
      width: 320,
      height: 320,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    });
    waitMs = Math.max(data.ms_until_next + 50, 500);
    animateQrProgressBar(waitMs);
  } catch (err) {
    if (/ended|not found|not authorized/i.test(err.message)) {
      toast(err.message, 'error');
      stopLiveLocally();
      return;
    }
  }
  qrTimer = setTimeout(refreshQr, waitMs);
}

document.getElementById('btn-fullscreen-qr').onclick = () => {
  const target = document.getElementById('live-fullscreen-target');
  if (!document.fullscreenElement) {
    target.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
};

async function refreshLiveRoster() {
  if (!activeSessionId) return;
  try {
    const records = await authedFetch(`/api/session-attendance?session_id=${activeSessionId}`);
    document.getElementById('live-count').textContent = records.length;

    const feed = document.getElementById('live-checkin-feed');
    if (records.length === 0) {
      feed.innerHTML = `<div class="empty-state"><p>Waiting for first student check-in…</p></div>`;
    } else {
      feed.innerHTML = records.slice(0, 30).map(r => {
        const roll = r.students?.roll_number || 'Verified';
        return `
          <div class="ledger-row" style="cursor:default; padding: 10px 18px;">
            <span class="mono" style="font-weight: 600;">${escapeHtml(roll)}</span>
            <span class="mono text-dim" style="font-size: 0.76rem;">${formatTime(r.marked_at)}</span>
          </div>`;
      }).join('');
    }

    if (document.getElementById('tview-map').classList.contains('is-active')) {
      loadLocationMap(true);
    }
  } catch (err) { console.error('roster fetch failed:', err); }
}

document.getElementById('btn-end-session').onclick = async () => {
  const ok = await confirmSheet({
    title: 'End this session?',
    body: 'The rotating QR code will stop immediately and no further student scans will be accepted.',
    confirmLabel: 'End session',
    danger: true
  });
  if (!ok) return;
  try {
    await authedFetch('/api/end-session', {
      method: 'POST',
      body: JSON.stringify({ session_id: activeSessionId })
    });
  } catch (err) { toast(err.message, 'error'); return; }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  stopLiveLocally();
  toast('Session ended and attendance finalized.', 'success');
  await loadCourseData();
};

// ---------------------------------------------------------------- location map

const CAMPUS_CENTER = [26.4716, 73.1134];

let locMap = null;
let locMarkers = [];
let locData = null;
let locCourseId = null;
let locSeq = 0;

function initLocMap() {
  const el = document.getElementById('all-sessions-map');
  if (locMap || !el) return;
  locMap = L.map('all-sessions-map', {
    center: CAMPUS_CENTER, zoom: 16, minZoom: 14, maxZoom: 19,
    scrollWheelZoom: true, dragging: true, touchZoom: true,
    doubleClickZoom: true, boxZoom: true, preferCanvas: true
  });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'osm-dark', referrerPolicy: 'origin',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(locMap);
}

function setLocEmpty(msg) {
  document.getElementById('map-empty-msg').textContent = msg;
  document.getElementById('map-empty').classList.remove('hidden');
  document.getElementById('map-content').classList.add('hidden');
}

async function loadLocationMap(force) {
  if (!selectedCourseId) { setLocEmpty('Select or create a course first.'); return; }
  if (!force && locData && locCourseId === selectedCourseId) { showLocationMap(); return; }

  const seq = ++locSeq;
  setLocEmpty('Loading GPS verification data…');
  let data;
  try {
    data = await authedFetch(`/api/course-locations?course_id=${encodeURIComponent(selectedCourseId)}`);
  } catch (err) {
    if (seq === locSeq) setLocEmpty(err.message);
    return;
  }
  if (seq !== locSeq) return;
  locData = data;
  locCourseId = selectedCourseId;
  showLocationMap(true);
}

function showLocationMap() {
  if (!locData || !locData.sessions || !locData.sessions.length) {
    setLocEmpty('No lectures found for this course yet.');
    return;
  }
  if (typeof L === 'undefined') { setLocEmpty('Map library failed to load. Reload the page.'); return; }

  document.getElementById('map-empty').classList.add('hidden');
  document.getElementById('map-content').classList.remove('hidden');
  initLocMap();
  if (!locMap) return;

  buildSessionSelect();
  drawSelectedSession();
  setTimeout(() => locMap && locMap.invalidateSize(), 200);
}

function buildSessionSelect() {
  const sel = document.getElementById('map-session-select');
  if (!sel || !locData || !locData.sessions) return;
  const prevVal = sel.value;
  const reversed = locData.sessions.slice().reverse();
  sel.innerHTML = reversed.map((s, ri) => {
    const i = locData.sessions.length - 1 - ri;
    const label = `${formatDate(s.date)}${s.is_live ? ' (Live)' : ''}`;
    return `<option value="${i}">${label}</option>`;
  }).join('');
  if (prevVal !== '' && !isNaN(parseInt(prevVal, 10)) && parseInt(prevVal, 10) < locData.sessions.length) {
    sel.value = prevVal;
  }
  sel.onchange = () => drawSelectedSession();
}

function getDistanceFromCampus(lat, lng) {
  const R = 6371e3;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat - CAMPUS_CENTER[0]);
  const dLon = toRad(lng - CAMPUS_CENTER[1]);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(CAMPUS_CENTER[0])) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function drawSelectedSession() {
  locMarkers.forEach(m => m.remove());
  locMarkers = [];

  const sel = document.getElementById('map-session-select');
  const sessionIdx = parseInt(sel.value, 10);
  if (isNaN(sessionIdx)) return;

  const sess = locData.sessions[sessionIdx];
  let withGps = 0;
  let offCampus = 0;

  locData.points.forEach(([i, lat, lng, roll]) => {
    if (i !== sessionIdx) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    withGps++;

    const dist = getDistanceFromCampus(lat, lng);
    const isOut = dist > 3000;
    if (isOut) offCampus++;

    // Uses institutional cobalt (#3b82f6) for valid campus check-ins and amber (#f59e0b) for >3km outliers
    const color = isOut ? '#f59e0b' : '#3b82f6';
    const popupExtra = isOut
      ? `<br><span style="color:#f59e0b; font-weight:600;">Outside campus (~${(dist / 1000).toFixed(1)} km)</span>`
      : '';

    const m = L.circleMarker([lat, lng], {
      color, fillColor: color, fillOpacity: 0.78, radius: 6, weight: 1.5
    }).bindPopup(`<strong>${escapeHtml(roll)}</strong><br>${formatDate(sess.date)}${popupExtra}`)
      .addTo(locMap);
    locMarkers.push(m);
  });

  const totalScans = locData.points.filter(p => p[0] === sessionIdx).length;
  const offNote = offCampus > 0 ? ` · ${offCampus} outside campus` : '';
  document.getElementById('map-summary').textContent =
    `${totalScans} check-ins · ${withGps} with GPS${offNote} · ${formatDate(sess.date)}`;

  if (locMarkers.length > 0) {
    const group = L.featureGroup(locMarkers);
    locMap.fitBounds(group.getBounds().pad(0.3));
  } else if (locMap) {
    locMap.setView(CAMPUS_CENTER, 16);
  }
}

function exportLocationCsv() {
  if (!locData) return;
  const cell = v => {
    let t = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  };
  const lines = [['Lecture Date', 'Roll Number', 'Latitude', 'Longitude'].map(cell).join(',')];
  locData.points.forEach(([i, lat, lng, roll]) =>
    lines.push([formatDate(locData.sessions[i].date), roll, lat, lng].map(cell).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = 'scan-locations.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.getElementById('btn-map-refresh').onclick = () => loadLocationMap(true);
document.getElementById('btn-map-export').onclick = exportLocationCsv;

init();
