// Which assistant results the page in front of you can actually apply.
//
// The proposal and document assistants both return two kinds of applyable
// result: a whole `draft` and a list of `edits`. Each host page wires the
// handlers it supports, and the Apply button used to key off a single boolean,
// "is either handler wired". On the proposal editor, which wired only
// onApplyEdits, that showed an Apply button on a draft card whose click had
// nowhere to go: no change, no error, nothing in the console.
//
// The kinds are deliberately checked one by one rather than defaulting to true,
// so a new payload kind has to be wired up on purpose before it offers a button
// that cannot work.

export type AgentApplyHandlers = {
  onApplyDraft?: unknown;
  onApplyEdits?: unknown;
};

export function canApplyPayloadKind(
  handlers: AgentApplyHandlers,
  kind: string | null | undefined,
): boolean {
  if (kind === 'draft') return Boolean(handlers.onApplyDraft);
  if (kind === 'edits') return Boolean(handlers.onApplyEdits);
  return false;
}
