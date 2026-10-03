/* ==========================================================================
   teacher.js — instructor console logic
   ========================================================================== */

let session = null;
let courses = [];
let selectedCourseId = null;
let courseDataCache = null; // { total_sessions, sessions:[{id,session_date}], stats:[...] }

let activeSessionId = null;
let rotationSeconds = 6;
let qrTimer = null;
let pollInterval = null;
let liveQrCodeInstance = null;

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
    await loadCourseData();
  };
}

function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// ---------------------------------------------------------------- nav

document.querySelectorAll('.navrail-item[data-view]').forEach(btn => {
  btn.onclick = () => switchView(btn.dataset.view);
});

const titles = { overview: 'Class Overview', grid: 'Attendance Sheet', live: 'Live session', courses: 'Manage courses' };

function switchView(name) {
  document.querySelectorAll('.navrail-item[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
  document.querySelectorAll('.teacher-view').forEach(v => v.classList.remove('is-active'));
  document.getElementById('tview-' + name).classList.add('is-active');
  document.getElementById('page-title').textContent = titles[name];
  document.getElementById('course-select').style.visibility = name === 'courses' ? 'hidden' : 'visible';
  if (name === 'live') renderLiveView();
}

function showEmptyStates() {
  document.getElementById('overview-empty').classList.remove('hidden');
  document.getElementById('overview-content').classList.add('hidden');
  document.getElementById('grid-empty').classList.remove('hidden');
  document.getElementById('grid-content').classList.add('hidden');
}

// ---------------------------------------------------------------- course data (overview + grid share one fetch)

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
}

function renderOverview() {
  const { total_sessions, stats } = courseDataCache;
  document.getElementById('overview-empty').classList.add('hidden');
  document.getElementById('overview-content').classList.remove('hidden');
  document.getElementById('overview-session-count').textContent = `${total_sessions} lecture${total_sessions === 1 ? '' : 's'} held`;

  const avgPct = stats.length ? Math.round(stats.reduce((a, s) => a + s.percentage, 0) / stats.length) : 0;
  document.getElementById('overview-donut').innerHTML = donutSVG(avgPct, 108, 10);
  animateDonuts(document.getElementById('overview-donut'));
  document.getElementById('overview-avg').textContent = avgPct + '%';

  const atRisk = stats.filter(s => s.percentage < 75).sort((a, b) => a.percentage - b.percentage);
  document.getElementById('overview-at-risk-count').textContent = atRisk.length;

  const panel = document.getElementById('at-risk-panel');
  if (atRisk.length === 0) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><p>No one is below 75% right now.</p></div>`;
  } else {
    panel.innerHTML = `<div class="ledger-head"><h3>Below 75%</h3><span class="meta">${atRisk.length} student${atRisk.length === 1 ? '' : 's'}</span></div>
      <div class="ledger-body--flush">` + atRisk.map(s => `
        <div class="ledger-row" style="cursor:default;">
          <div class="ledger-row-main">
            <div class="ledger-row-title">${escapeHtml(s.name)}</div>
            <div class="ledger-row-sub mono">${escapeHtml(s.roll_number)}</div>
          </div>
          <span class="badge badge-warn">${s.percentage}%</span>
        </div>`).join('') + `</div>`;
  }

  const rows = stats.slice().sort((a, b) => a.roll_number.localeCompare(b.roll_number));
  document.getElementById('roster-table-body').innerHTML = rows.map(s => `
    <tr>
      <td><strong>${escapeHtml(s.roll_number)}</strong><br><span class="text-dim" style="font-size:0.78rem;">${escapeHtml(s.name)}</span></td>
      <td class="num">${s.attended_classes}/${s.total_classes}</td>
      <td class="num"><span class="badge ${s.percentage < 75 ? 'badge-warn' : 'badge-verified'}">${s.percentage}%</span></td>
      <td class="num"><button class="link-btn" data-remove-student="${escapeHtml(s.roll_number)}" style="color:var(--absent-strong);">Remove</button></td>
    </tr>`).join('') || `<tr><td colspan="4" class="text-dim" style="text-align:center; padding:20px;">No students enrolled yet.</td></tr>`;

  document.getElementById('roster-table-body').querySelectorAll('[data-remove-student]').forEach(btn => {
    btn.onclick = async () => {
      const roll_number = btn.dataset.removeStudent;
      const ok = await confirmSheet({
        title: 'Remove this student?',
        body: `${roll_number} will be unenrolled from this course. Their past attendance records are kept.`,
        confirmLabel: 'Remove', danger: true
      });
      if (!ok) return;
      try {
        await authedFetch('/api/remove-enrollment', { method: 'POST', body: JSON.stringify({ course_id: selectedCourseId, roll_number }) });
        toast('Student removed from course.', 'success');
        await loadCourseData();
      } catch (err) { toast(err.message, 'error'); }
    };
  });
}

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

document.getElementById('btn-grid-mark').onclick = () => submitManualAttendance('add');
document.getElementById('btn-grid-unmark').onclick = () => submitManualAttendance('remove');

async function submitManualAttendance(action) {
  const session_id = document.getElementById('grid-session-select').value;
  const input = document.getElementById('grid-manual-roll');
  const roll_number = input.value.trim();
  if (!session_id) { toast('No lecture selected.', 'error'); return; }
  if (!roll_number) { toast('Enter a roll number.', 'error'); return; }
  try {
    const data = await authedFetch('/api/add-attendance-manual', {
      method: 'POST',
      body: JSON.stringify({ session_id, roll_number, action })
    });
    toast(action === 'remove' ? `${data.name} removed from this lecture.` : `${data.name} marked present.`, 'success');
    input.value = '';
    await loadCourseData();
  } catch (err) { toast(err.message, 'error'); }
}

// ---------------------------------------------------------------- lecture grid

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
  const mostRecentFirst = sorted.slice().reverse();
  sel.innerHTML = mostRecentFirst.map(s => `<option value="${s.id}">${formatDate(s.session_date)}</option>`).join('');

  const head = `<thead><tr><th>Student</th>${sorted.map(s => `<th>${formatDate(s.session_date).slice(0, 6)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>` + stats.slice().sort((a, b) => a.roll_number.localeCompare(b.roll_number)).map(s => {
    const present = new Set(s.present_session_ids || []);
    return `<tr><td>${escapeHtml(s.roll_number)}</td>${sorted.map(sess => `
      <td><span class="grid-mark ${present.has(sess.id) ? 'present' : 'absent'}">${present.has(sess.id) ? '✓' : '·'}</span></td>`).join('')}</tr>`;
  }).join('') + `</tbody>`;

  document.getElementById('lecture-grid-table').innerHTML = head + body;
}

// ---------------------------------------------------------------- manage courses

document.getElementById('btn-create-course').onclick = async () => {
  const course_code = document.getElementById('input-new-code').value.trim();
  const course_name = document.getElementById('input-new-name').value.trim();
  if (!course_code || !course_name) { toast('Enter both a course code and a name.', 'error'); return; }
  try {
    await authedFetch('/api/teacher-courses', { method: 'POST', body: JSON.stringify({ action: 'create_course', course_code, course_name }) });
    document.getElementById('input-new-code').value = '';
    document.getElementById('input-new-name').value = '';
    toast('Course created.', 'success');
    courses = await authedFetch('/api/teacher-courses');
    populateCourseSelect();
    renderCoursesManageList();
  } catch (err) { toast(err.message, 'error'); }
};

function renderCoursesManageList() {
  const el = document.getElementById('courses-manage-list');
  el.innerHTML = courses.length ? courses.map(c => `
    <div class="ledger-row ledger-row--stack">
      <div class="spread">
        <div class="ledger-row-main">
          <div class="ledger-row-title">${escapeHtml(c.course_name)}</div>
          <div class="ledger-row-sub mono">${escapeHtml(c.course_code)} · ${c.user_role}</div>
        </div>
        ${c.user_role === 'INSTRUCTOR' ? `<button class="link-btn" data-del="${c.id}" style="color:var(--absent-strong);">Delete</button>` : ''}
      </div>
      ${c.user_role === 'INSTRUCTOR' ? `
        <div>
          <div class="ta-manage-label">TAs</div>
          <div class="ta-chip-row">
            ${(c.tas || []).map(ta => `
              <span class="ta-chip">
                ${escapeHtml(ta.email)}
                <button class="ta-chip-remove" data-rm-ta="${c.id}|${escapeHtml(ta.email)}">×</button>
              </span>`).join('') || '<span class="text-dim" style="font-size:0.82rem;">None yet</span>'}
          </div>
          <div class="ta-add-row">
            <input class="input input-paper" data-ta-input="${c.id}" placeholder="TA email">
            <button class="btn btn-ghost-paper" data-add-ta="${c.id}" style="width:auto; padding-inline:14px;">Add TA</button>
          </div>
        </div>` : ''}
    </div>`).join('') : `<div class="empty-state"><p>No courses yet.</p></div>`;

  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      const course = courses.find(c => String(c.id) === btn.dataset.del);
      const ok = await confirmSheet({
        title: 'Delete this course?',
        body: `This permanently removes ${course.course_code} and all of its sessions and attendance records.`,
        confirmLabel: 'Delete course', danger: true
      });
      if (!ok) return;
      try {
        await authedFetch('/api/teacher-courses', { method: 'POST', body: JSON.stringify({ action: 'delete_course', course_id: course.id }) });
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
      if (!ta_email) { toast('Enter a TA email.', 'error'); return; }
      try {
        await authedFetch('/api/manage-ta', { method: 'POST', body: JSON.stringify({ action: 'add', course_id, ta_email }) });
        toast('TA added.', 'success');
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
        body: `${ta_email} will no longer be able to run sessions for this course.`,
        confirmLabel: 'Remove', danger: true
      });
      if (!ok) return;
      try {
        await authedFetch('/api/manage-ta', { method: 'POST', body: JSON.stringify({ action: 'remove', course_id, ta_email }) });
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
    const data = await authedFetch('/api/start-session', { method: 'POST', body: JSON.stringify({ course_id: selectedCourseId }) });
    activeSessionId = data.session_id;
    rotationSeconds = data.rotation_seconds || 6;
    if (data.resumed) toast('Resumed the session already running for this course.', 'success');

    document.getElementById('live-count').textContent = '0';
    renderLiveView();
    clearTimeout(qrTimer); clearInterval(pollInterval);
    refreshQr();
    pollInterval = setInterval(refreshLiveRoster, 4000);
    refreshLiveRoster();
  } catch (err) { toast(err.message, 'error'); }
};

async function refreshQr() {
  if (!activeSessionId) return;
  let waitMs = 1000;
  try {
    const data = await authedFetch(`/api/session-qr?session_id=${encodeURIComponent(activeSessionId)}`);
    const box = document.getElementById('qr-box');
    box.innerHTML = '';
    liveQrCodeInstance = new QRCode(box, {
      text: data.payload, width: 280, height: 280,
      colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L
    });
    waitMs = Math.max(data.ms_until_next + 50, 500);
  } catch (err) {
    if (/ended|not found|not authorized/i.test(err.message)) { toast(err.message, 'error'); stopLiveLocally(); return; }
  }
  qrTimer = setTimeout(refreshQr, waitMs);
}

async function refreshLiveRoster() {
  if (!activeSessionId) return;
  try {
    const records = await authedFetch(`/api/session-attendance?session_id=${activeSessionId}`);
    document.getElementById('live-count').textContent = records.length;
  } catch (err) { /* transient */ }
}

document.getElementById('btn-end-session').onclick = async () => {
  const ok = await confirmSheet({ title: 'End this session?', body: 'Students will no longer be able to scan in.', confirmLabel: 'End session', danger: true });
  if (!ok) return;
  try { await authedFetch('/api/end-session', { method: 'POST', body: JSON.stringify({ session_id: activeSessionId }) }); }
  catch (err) { toast(err.message, 'error'); return; }
  stopLiveLocally();
  await loadCourseData();
};

init();
