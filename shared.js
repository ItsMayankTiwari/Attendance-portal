/* ==========================================================================
   shared.js — common helpers used by both the student and teacher apps.
   No build step, no framework: plain functions attached to `window`.
   ========================================================================== */

const SUPABASE_URL = 'https://fdjbmnpqyzsxwwgavhnd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkamJtbnBxeXpzeHd3Z2F2aG5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4NDcsImV4cCI6MjEwMzA0Nzg0N30.VxyBjad4MtjgV8uWboBimvmWBkpku4GTKj41O7QxLYg';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Only @iitj.ac.in accounts are meaningful here — hint it to Google so the
// account chooser is pre-filtered. This is a UX nicety only: every API
// route re-checks the domain server-side, which is the real gate.
const INSTITUTE_DOMAIN = 'iitj.ac.in';

function googleSignIn(redirectTo) {
  return supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo || window.location.href,
      queryParams: { hd: INSTITUTE_DOMAIN, prompt: 'select_account' }
    }
  });
}

// ---- toasts ---------------------------------------------------------------

function ensureToastStack() {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function toast(message, variant) {
  const stack = ensureToastStack();
  const el = document.createElement('div');
  el.className = 'toast' + (variant ? ' is-' + variant : '');
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.25s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 3400);
}

// ---- authenticated fetch ---------------------------------------------------

async function authedFetch(path, opts = {}) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { throw new Error('Your session expired. Please sign in again.'); }

  const headers = Object.assign(
    { 'Authorization': `Bearer ${session.access_token}` },
    opts.body ? { 'Content-Type': 'application/json' } : {},
    opts.headers || {}
  );

  const res = await fetch(path, Object.assign({}, opts, { headers }));
  const raw = await res.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch (e) { throw new Error(`Server error (${res.status}). Try again in a moment.`); }

  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// ---- formatting -------------------------------------------------------------

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
}

function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(d) {
  return new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function pctClass(pct) {
  if (pct < 75) return 'is-low';
  if (pct < 85) return 'is-mid';
  return '';
}

// ---- donut chart (hand-rolled SVG, no chart library needed) ---------------

function donutSVG(pct, size = 132, stroke = 11) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return `
    <svg viewBox="0 0 ${size} ${size}">
      <circle class="donut-track" cx="${size/2}" cy="${size/2}" r="${r}"></circle>
      <circle class="donut-value ${pctClass(pct)}" cx="${size/2}" cy="${size/2}" r="${r}"
        stroke-dasharray="${c}" stroke-dashoffset="${c}" data-final-offset="${offset}"></circle>
    </svg>`;
}

// call after inserting donutSVG into the DOM so the fill-in animates once
function animateDonuts(root = document) {
  root.querySelectorAll('.donut-value[data-final-offset]').forEach(el => {
    const target = el.getAttribute('data-final-offset');
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.strokeDashoffset = target; }));
  });
}

// ---- QR HMAC (teacher side; Web Crypto, no library needed) ----------------

async function hmacHex(secretHex, message) {
  const keyBytes = new Uint8Array(secretHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function currentQrPayload(sessionId, secretHex, rotationSeconds) {
  const bucket = Math.floor(Date.now() / 1000 / rotationSeconds);
  const mac = await hmacHex(secretHex, `${sessionId}:${bucket}`);
  return `${sessionId}:${bucket}:${mac}`;
}

// ---- tiny confirm sheet (replaces native confirm()) -----------------------

function confirmSheet({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop center-modal is-open';
    backdrop.innerHTML = `
      <div class="sheet">
        <h3 style="margin-bottom:8px;">${title}</h3>
        <p class="text-dim" style="margin-bottom:18px;">${body}</p>
        <div class="btn-row">
          <button class="btn btn-ghost-paper" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.dataset.act === 'cancel') { backdrop.remove(); resolve(false); }
      if (e.target.dataset.act === 'ok') { backdrop.remove(); resolve(true); }
    });
  });
}
