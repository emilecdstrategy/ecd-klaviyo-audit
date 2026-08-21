// Writing a long document across several calls.
//
// One request has 150 seconds before the gateway closes it, and a full
// agreement does not fit in that: a 16k token body is several minutes of
// generation. So the model writes as much as fits, flags that there is more,
// and the app asks for the next part. The parts are joined here.

/** How much of what is already written is shown back when continuing. Enough
 *  for the model to pick up the thread without resending the whole document. */
export const CONTINUE_TAIL_CHARS = 4_000;

/** A backstop on runaway continuation, well past any real document. */
export const MAX_DOC_CHARS = 200_000;

/** What the model is told when it stopped part-way. The written body is not in
 *  the transcript (assistant history carries only chat text), so the tail is
 *  handed back explicitly, along with the headings already used, so a later
 *  part cannot quietly restart the document. */
export function continuationPrompt(written: string, isEdit: boolean): string {
  const tool = isEdit ? "propose_edits" : "propose_draft";
  const headings = Array.from(written.matchAll(/^#{1,3} +(.+)$/gm)).map((m) => m[1].trim());
  const tail = written.length > CONTINUE_TAIL_CHARS ? written.slice(-CONTINUE_TAIL_CHARS) : written;
  return [
    "Continue the document. This is a continuation request from the app, not a new instruction from the user.",
    headings.length > 0
      ? "Sections already written: " + headings.join("; ") + ". Do not write any of these again."
      : "",
    'The document so far ends like this:\n\n"""\n' + tail + '\n"""',
    "Carry on from exactly where that stops. Call " +
      tool +
      " again with ONLY the next part of the body in content: no title line, no repeated heading, no recap, no 'continuing from above'. The parts are joined together for the user, so anything you repeat appears twice. Keep this part to about 1,200 words, stop at a clean section boundary, and set more to true if the document still is not finished after it. Set more to false on the part that finishes it.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Join the next part onto what is already written. Exactly one blank line
 *  between them, whatever whitespace each part carries at its edges, and a
 *  repeated opening heading dropped rather than shown twice: the instruction
 *  not to repeat is a request, and this is the guard for when it is ignored. */
export function joinParts(written: string, next: string): string {
  const head = written.replace(/\s+$/, "");
  let tail = next.replace(/^\s+/, "");
  const lastHeading = [...head.matchAll(/^(#{1,3} +.+)$/gm)].pop()?.[1]?.trim();
  if (lastHeading) {
    const firstLine = tail.split("\n", 1)[0].trim();
    if (firstLine === lastHeading) tail = tail.slice(tail.indexOf("\n") + 1).replace(/^\s+/, "");
  }
  if (!tail) return head;
  return head + "\n\n" + tail;
}
