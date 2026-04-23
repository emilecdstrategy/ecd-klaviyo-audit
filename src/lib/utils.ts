import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Human-readable message for catch blocks (Postgrest errors are plain objects, not Error). */
export function formatUnknownError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (!e || typeof e !== 'object') return 'Something went wrong';
  const o = e as Record<string, unknown>;
  const parts = [o.message, o.details, o.hint, o.code].filter((x) => typeof x === 'string' && String(x).trim());
  if (parts.length) return parts.map(String).join(' — ');
  try {
    return JSON.stringify(e);
  } catch {
    return 'Something went wrong';
  }
}

