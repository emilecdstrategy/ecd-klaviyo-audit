import { supabase } from './supabase';

/** Resolves `actor_user_id` on a batch of event rows to display names in one query,
 * for activity-log UIs that need to show "by whom" without an extra fetch per row. */
export async function attachActorNames<T extends { actor_user_id: string | null }>(
  events: T[],
): Promise<(T & { actor_name: string | null })[]> {
  const ids = [...new Set(events.map(e => e.actor_user_id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return events.map(e => ({ ...e, actor_name: null }));

  const { data, error } = await supabase.from('profiles').select('id, name').in('id', ids);
  if (error) throw error;
  const nameById = new Map((data ?? []).map(p => [p.id as string, p.name as string]));
  return events.map(e => ({ ...e, actor_name: e.actor_user_id ? nameById.get(e.actor_user_id) ?? null : null }));
}
