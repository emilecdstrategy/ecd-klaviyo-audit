import { ENTITY_CHIP_CLASS, type EntityType } from './entity-tags';

export function wrapSelectionAsEntity(root: HTMLElement | null, type: EntityType): boolean {
  const sel = window.getSelection();
  if (!root || !sel || sel.rangeCount === 0) return false;

  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return false;

  const text = range.toString();
  if (!text.trim()) return false;

  const span = document.createElement('span');
  span.setAttribute('data-entity-type', type);
  span.className = ENTITY_CHIP_CLASS[type];
  span.textContent = text;

  range.deleteContents();
  range.insertNode(span);

  const after = document.createRange();
  after.setStartAfter(span);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);

  return true;
}
