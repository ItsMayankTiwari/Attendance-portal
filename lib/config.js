export const ROTATION_SECONDS = 4;
export const QR_GRACE_MS = 2000;                 // QR still valid this long after it rotates off screen
export const FINGERPRINT_WINDOW_MS = 30 * 1000;  // time to finish fingerprint after QR is accepted
export const SESSION_MAX_MS = 2 * 60 * 60 * 1000;  // sessions auto-close after 2 h

export function qrBucketIsValid(bucket, now = Date.now()) {
    const current = Math.floor(now / 1000 / ROTATION_SECONDS);
    if (bucket === current) return true;
    if (bucket === current - 1) {
        return now - current * ROTATION_SECONDS * 1000 <= QR_GRACE_MS;
    }
    return false;
}

export function sessionIsLive(session) {
    return !!session && session.is_active !== false &&
        Date.now() - new Date(session.session_date).getTime() < SESSION_MAX_MS;
}
