export const ROTATION_SECONDS = 6;
export const SESSION_MAX_MS = 3 * 60 * 60 * 1000;  // sessions auto-close after 3 h
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;     // fingerprint step must finish in 2 min

export function sessionIsLive(session) {
    return !!session && session.is_active !== false &&
        Date.now() - new Date(session.session_date).getTime() < SESSION_MAX_MS;
}

// Optional campus-network gate. Leave ALLOWED_IP_PREFIXES unset to disable.
// Example: "14.139.,10.20." (end each prefix with a dot).
const prefixes = (process.env.ALLOWED_IP_PREFIXES || '').split(',').map(s => s.trim()).filter(Boolean);
export function clientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    return (typeof xff === 'string' ? xff.split(',')[0] : (req.socket && req.socket.remoteAddress) || '').trim();
}
export function ipAllowed(req) {
    return prefixes.length === 0 || prefixes.some(p => clientIp(req).startsWith(p));
}
