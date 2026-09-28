import { useEffect, useRef, type RefObject } from 'react';

/** How close to the bottom (px) still counts as "at the bottom". */
const NEAR_BOTTOM = 80;

/**
 * Keeps a chat's scroll container at the latest message.
 *
 * Scrolling once after render was not enough: markdown, images, doc previews
 * and the panel's slide-in keep growing the list after the first frame, so a
 * reopened chat landed somewhere above the last message. This pins the view to
 * the bottom whenever the content grows, until the reader scrolls up to read
 * something; sending a message or reopening the panel pins it again.
 *
 * @param open    whether the panel is showing; reopening pins to the bottom
 * @param repin   changes when the view should jump back down (e.g. `sending`)
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, open = true, repin?: unknown) {
  const pinned = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    pinned.current = true;
    const toBottom = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    };
    toBottom();
    const frame = requestAnimationFrame(toBottom);

    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    // Content that grows later: new or re-rendered messages, and images that
    // finish loading (load does not bubble, so listen in the capture phase).
    const mutations = new MutationObserver(toBottom);
    mutations.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener('load', toBottom, true);
    const resize = new ResizeObserver(toBottom);
    resize.observe(el);
    for (const child of Array.from(el.children)) resize.observe(child);

    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('load', toBottom, true);
      mutations.disconnect();
      resize.disconnect();
    };
  }, [ref, open]);

  // Sending a message, or anything else the caller treats as "go to the latest".
  useEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    pinned.current = true;
    el.scrollTop = el.scrollHeight;
  }, [ref, open, repin]);
}
