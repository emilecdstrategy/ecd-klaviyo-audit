import { useCallback, useEffect, useRef } from 'react';

/** How close to the bottom (px) still counts as "at the bottom". */
const NEAR_BOTTOM = 80;

type Entry = { pinned: boolean; toBottom: () => void; cleanup: () => void };

/**
 * Keeps a chat's scroll container at the latest message. Returns a callback
 * ref for the scrolling element.
 *
 * Scrolling once after render was not enough: the saved conversation loads a
 * moment after the panel opens, and markdown, images and previews keep growing
 * the list after that. This pins the view to the bottom whenever the content
 * grows, until the reader scrolls up to read something; sending a message or
 * reopening the panel pins it again.
 *
 * It is a callback ref, not a ref object, because the assistant panels render
 * their body twice (a desktop panel and a mobile overlay that mounts while
 * open). A shared ref object ended up pointing at the hidden overlay copy, so
 * the visible chat never scrolled. Every attached element is handled.
 *
 * @param open   whether the panel is showing; reopening pins to the bottom
 * @param repin  changes when the view should jump back down (e.g. `sending`)
 */
export function useStickToBottom<T extends HTMLElement = HTMLDivElement>(open = true, repin?: unknown) {
  const entries = useRef(new Map<T, Entry>());

  const prune = useCallback(() => {
    for (const [el, entry] of entries.current) {
      if (!el.isConnected) {
        entry.cleanup();
        entries.current.delete(el);
      }
    }
  }, []);

  const ref = useCallback(
    (el: T | null) => {
      prune();
      if (!el || entries.current.has(el)) return;

      const entry: Entry = {
        pinned: true,
        toBottom: () => {
          if (entry.pinned && el.isConnected) el.scrollTop = el.scrollHeight;
        },
        cleanup: () => {},
      };
      const onScroll = () => {
        entry.pinned = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      // Content that arrives or grows later: the loaded history, new messages,
      // and images that finish loading (load does not bubble: capture phase).
      const mutations = new MutationObserver(entry.toBottom);
      mutations.observe(el, { childList: true, subtree: true, characterData: true });
      el.addEventListener('load', entry.toBottom, true);
      const resize = new ResizeObserver(entry.toBottom);
      resize.observe(el);
      entry.cleanup = () => {
        el.removeEventListener('scroll', onScroll);
        el.removeEventListener('load', entry.toBottom, true);
        mutations.disconnect();
        resize.disconnect();
      };
      entries.current.set(el, entry);
      entry.toBottom();
      requestAnimationFrame(entry.toBottom);
    },
    [prune],
  );

  // Opening the panel, sending a message, or anything else the caller treats
  // as "go to the latest" pins every copy back to the bottom.
  useEffect(() => {
    if (!open) return;
    prune();
    for (const entry of entries.current.values()) {
      entry.pinned = true;
      entry.toBottom();
    }
    const frame = requestAnimationFrame(() => {
      for (const entry of entries.current.values()) entry.toBottom();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, repin, prune]);

  useEffect(() => {
    const map = entries.current;
    return () => {
      for (const entry of map.values()) entry.cleanup();
      map.clear();
    };
  }, []);

  return ref;
}
