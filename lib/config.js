export const ROTATION_SECONDS = 5;
export const SESSION_MAX_MS = 3 * 60 * 60 * 1000;  // sessions auto-close after 3 h
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;     // fingerprint step must finish in 2 min

export function sessionIsLive(session) {
    return !!session && session.is_active !== false &&
        Date.now() - new Date(session.session_date).getTime() < SESSION_MAX_MS;
}
