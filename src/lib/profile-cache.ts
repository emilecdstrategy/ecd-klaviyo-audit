import type { Profile } from './types';

const PROFILE_CACHE_KEY = 'ecd_auth_profile_v1';

export function readCachedProfile(): Profile | null {
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { profile?: Profile };
    return parsed.profile ?? null;
  } catch {
    return null;
  }
}

export function writeCachedProfile(profile: Profile) {
  try {
    sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ profile }));
  } catch {
    /* ignore quota errors */
  }
}

export function clearCachedProfile() {
  try {
    sessionStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    /* ignore */
  }
}
