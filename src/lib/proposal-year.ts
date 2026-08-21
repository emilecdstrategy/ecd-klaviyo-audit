import type { Proposal } from './types';

/** The analytics window on the proposals dashboard. */
export type ProposalYear = number | 'all';

/**
 * A proposal does not have one year, it has several.
 *
 * A deal created in December and signed in January was won this year and
 * created last year, and both readings are correct. So each metric asks about
 * the date that metric is actually about: Won asks when it was won, Lost when
 * it was lost, and the open pipeline, which has no closing date yet, asks when
 * it was created. That is what "we won $X in 2026" means to the person reading
 * the card, and it is how the Sent vs won chart has always worked.
 */
export function yearOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const year = Number(String(iso).slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : null;
}

/** Does this date fall in the selected window? 'all' accepts everything, and a
 *  missing date is never counted into a specific year: a won proposal with no
 *  won_at would otherwise land in whichever year happened to be showing. */
export function inYear(iso: string | null | undefined, year: ProposalYear): boolean {
  if (year === 'all') return true;
  return yearOf(iso) === year;
}

/** Every year the data touches, newest first, with the current year always
 *  present so the default selection is never an empty list. */
export function availableYears(proposals: Proposal[]): number[] {
  const years = new Set<number>([new Date().getFullYear()]);
  for (const p of proposals) {
    for (const iso of [p.created_at, p.sent_at, p.won_at, p.lost_at]) {
      const y = yearOf(iso);
      if (y !== null) years.add(y);
    }
  }
  return [...years].sort((a, b) => b - a);
}

/** The months to plot for a window, as YYYY-MM. A past year is all twelve; the
 *  current year stops at this month, because plotting months that have not
 *  happened yet reads as a collapse in demand. */
export function monthsForYear(year: ProposalYear, proposals: Proposal[]): string[] {
  const now = new Date();
  const label = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}`;
  if (year === 'all') {
    const stamps = proposals
      .map((p) => p.created_at)
      .filter((d): d is string => Boolean(d))
      .map((d) => new Date(d).getTime())
      .filter((t) => Number.isFinite(t));
    const start = stamps.length > 0 ? new Date(Math.min(...stamps)) : new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const out: string[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= now && out.length < 120) {
      out.push(label(cursor.getFullYear(), cursor.getMonth()));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out.length > 0 ? out : [label(now.getFullYear(), now.getMonth())];
  }
  const lastMonth = year === now.getFullYear() ? now.getMonth() : 11;
  const out: string[] = [];
  for (let m = 0; m <= lastMonth; m++) out.push(label(year, m));
  return out;
}
