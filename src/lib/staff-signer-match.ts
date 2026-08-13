/** Matching a free-text signer name to a team member.
 *
 * Kept free of imports so it can be exercised on its own: the app has no test
 * runner, and this is the piece where a wrong answer means a document goes out
 * under someone else's name.
 */

export type SignerLike = { id: string; name: string; email: string };

const norm = (v: string) => v.trim().toLowerCase();

/** Resolve a hint from a human or the AI assistant ("Zak",
 * "zak@ecdigitalstrategy.com", "use Xiomara's signature") to a team member.
 * Returns null when nothing matches confidently, so the caller falls back to the
 * default signer rather than signing as the wrong person.
 *
 * Ordered strongest-first, and a loose match must be UNAMBIGUOUS: two people
 * called Zak make "Zak" meaningless, and guessing is worse than defaulting.
 *
 * Whole-word matching is essential, not a nicety: a substring test would find
 * "Isa" inside the word "signature", so "use Zak's signature" would match both
 * Isa and Zak, come out ambiguous, and silently fall back to the default. */
export function matchSigner<T extends SignerLike>(signers: T[], hint: string): T | null {
  const q = norm(hint);
  if (!q) return null;

  const byEmail = signers.find(s => norm(s.email) === q);
  if (byEmail) return byEmail;

  const byFullName = signers.find(s => norm(s.name) === q);
  if (byFullName) return byFullName;

  const words = new Set(
    q.replace(/[^a-z0-9@.\s'-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w.replace(/'s$/, '')),
  );
  const candidates = signers.filter(s => {
    const first = norm(s.name).split(/\s+/)[0];
    const local = norm(s.email).split('@')[0];
    if (first && words.has(first)) return true;
    if (local && words.has(local)) return true;
    // Full name inside a longer sentence ("signed by Zak Cassady-Dorion please").
    return norm(s.name).length > 2 && q.includes(norm(s.name));
  });
  return candidates.length === 1 ? candidates[0] : null;
}
