import { ENTITY_CHIP_CLASS, resolveEntityType, type EntityType } from './entity-tags';

export const HIGHLIGHT_SHORTCUT_LABEL = 'Ctrl+Shift+H';

export function isHighlightShortcut(e: KeyboardEvent): boolean {
  return (
    e.key.toLowerCase() === 'h' &&
    e.shiftKey &&
    !e.altKey &&
    (e.ctrlKey || e.metaKey)
  );
}

function findEntityTagAncestor(node: Node | null, root: HTMLElement): HTMLElement | null {
  let el: Node | null = node;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  while (el instanceof HTMLElement && el !== root) {
    if (el.hasAttribute('data-entity-type')) return el;
    el = el.parentElement;
  }
  return null;
}

function getEntityTagsInRange(root: HTMLElement, range: Range): HTMLElement[] {
  const tags: HTMLElement[] = [];
  root.querySelectorAll('[data-entity-type]').forEach(node => {
    if (range.intersectsNode(node)) tags.push(node as HTMLElement);
  });
  return tags;
}

function unwrapEntityTag(span: HTMLElement): void {
  const parent = span.parentNode;
  if (!parent) return;
  const textNode = document.createTextNode(span.textContent ?? '');
  parent.replaceChild(textNode, span);
}

export function selectionHasEntityHighlight(root: HTMLElement | null): boolean {
  const sel = window.getSelection();
  if (!root || !sel || sel.rangeCount === 0) return false;

  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return false;

  if (range.collapsed) {
    return findEntityTagAncestor(range.startContainer, root) !== null;
  }

  return getEntityTagsInRange(root, range).length > 0;
}

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

export function toggleSelectionHighlight(
  root: HTMLElement | null,
  lookup: Map<string, EntityType>,
): boolean {
  const sel = window.getSelection();
  if (!root || !sel || sel.rangeCount === 0) return false;

  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return false;

  if (range.collapsed) {
    const tag = findEntityTagAncestor(range.startContainer, root);
    if (!tag) return false;
    unwrapEntityTag(tag);
    return true;
  }

  const tagsInRange = getEntityTagsInRange(root, range);
  if (tagsInRange.length > 0) {
    tagsInRange.forEach(unwrapEntityTag);
    return true;
  }

  const text = range.toString();
  if (!text.trim()) return false;

  return wrapSelectionAsEntity(root, resolveEntityType(text, lookup));
}

/** @deprecated Use toggleSelectionHighlight */
export function wrapSelectionAsHighlight(
  root: HTMLElement | null,
  lookup: Map<string, EntityType>,
): boolean {
  return toggleSelectionHighlight(root, lookup);
}
