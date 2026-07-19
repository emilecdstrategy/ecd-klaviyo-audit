import { supabase } from './supabase';

// "What's new" dismissal state, stored server-side so it is shared across the
// audit. and proposal. subdomains (localStorage is per-origin) and across devices.

export async function getSeenAnnouncements(): Promise<string[]> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('user_announcement_state')
    .select('seen')
    .eq('user_id', uid)
    .maybeSingle();
  if (error || !data) return [];
  return Array.isArray(data.seen) ? (data.seen as string[]) : [];
}

export async function markAnnouncementsSeen(ids: string[]): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return;
  const existing = await getSeenAnnouncements();
  const merged = Array.from(new Set([...existing, ...ids]));
  const { error } = await supabase
    .from('user_announcement_state')
    .upsert({ user_id: uid, seen: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}
