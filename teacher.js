/* ==========================================================================
   teacher.js — instructor console logic
   ========================================================================== */

let session = null;
let courses = [];
let selectedCourseId = null;
let courseDataCache = null; // { total_sessions, sessions:[{id,session_date}], stats:[...] }

let activeSessionId = null;
let sessionSecret = null;
let rotationSeconds = 6;
let qrInterval = null;
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
    </tr>`).join('') || `<tr><td colspan="3" class="text-dim" style="text-align:center; padding:20px;">No students enrolled yet.</td></tr>`;
}

document.getElementById('btn-export-csv').onclick = () => {
  if (!courseDataCache) return;
  const course = courses.find(c => String(c.id) === String(selectedCourseId));
  const rows = [['Roll Number', 'Name', 'Attended', 'Total', 'Percentage']];
  courseDataCache.stats.forEach(s => rows.push([s.roll_number, s.name, s.attended_classes, s.total_classes, s.percentage + '%']));
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${course ? course.course_code : 'course'}-attendance.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

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
    <div class="ledger-row" style="cursor:default;">
      <div class="ledger-row-main">
        <div class="ledger-row-title">${escapeHtml(c.course_name)}</div>
        <div class="ledger-row-sub mono">${escapeHtml(c.course_code)} · ${c.user_role}</div>
      </div>
      ${c.user_role === 'INSTRUCTOR' ? `<button class="link-btn" data-del="${c.id}" style="color:var(--absent-strong);">Delete</button>` : ''}
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
}

// ---------------------------------------------------------------- live session

function renderLiveView() {
  document.getElementById('live-idle').classList.toggle('hidden', !!activeSessionId);
  document.getElementById('live-active').classList.toggle('hidden', !activeSessionId);
}

document.getElementById('btn-start-session').onclick = async () => {
  if (!selectedCourseId) { toast('Select a course first.', 'error'); return; }
  try {
    const data = await authedFetch('/api/start-session', { method: 'POST', body: JSON.stringify({ course_id: selectedCourseId }) });
    activeSessionId = data.session_id;
    sessionSecret = data.session_secret;
    rotationSeconds = data.rotation_seconds || 6;

    document.getElementById('live-count').textContent = '0';
    renderLiveView();

    await refreshQr();
    qrInterval = setInterval(refreshQr, rotationSeconds * 1000);
    pollInterval = setInterval(refreshLiveRoster, 4000);
    refreshLiveRoster();
  } catch (err) { toast(err.message, 'error'); }
};

async function refreshQr() {
  const payload = await currentQrPayload(activeSessionId, sessionSecret, rotationSeconds);
  const box = document.getElementById('qr-box');
  box.innerHTML = '';
  liveQrCodeInstance = new QRCode(box, {
    text: payload,
    width: 280,
    height: 280,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.L
  });
}

// Live updates come from a plain poll rather than Supabase Realtime: it works
// the same regardless of whether the project's replication settings are
// switched on, which is one less thing to remember to configure.
async function refreshLiveRoster() {
  if (!activeSessionId) return;
  try {
    const records = await authedFetch(`/api/session-attendance?session_id=${activeSessionId}`);
    document.getElementById('live-count').textContent = records.length;
  } catch (err) { /* transient poll errors are not worth interrupting the session for */ }
}

document.getElementById('btn-end-session').onclick = async () => {
  const ok = await confirmSheet({ title: 'End this session?', body: 'Students will no longer be able to scan in.', confirmLabel: 'End session', danger: true });
  if (!ok) return;
  try { await authedFetch('/api/end-session', { method: 'POST', body: JSON.stringify({ session_id: activeSessionId }) }); }
  catch (err) { toast(err.message, 'error'); }

  clearInterval(qrInterval); qrInterval = null;
  clearInterval(pollInterval); pollInterval = null;
  activeSessionId = null; sessionSecret = null;
  renderLiveView();
  await loadCourseData();
};

init();
