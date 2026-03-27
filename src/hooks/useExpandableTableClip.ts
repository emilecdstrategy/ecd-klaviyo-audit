import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Measures thead + first N tbody rows vs full table height for smooth max-height transitions.
 * Requires all tbody rows to be present in the DOM.
 */
export function useExpandableTableClip(rowCount: number, expanded: boolean, collapsedCount: number) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [collapsedH, setCollapsedH] = useState(320);
  const [fullH, setFullH] = useState(320);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const measure = () => {
      const table = wrap.querySelector('table');
      if (!table) return;
      const head = table.querySelector('thead');
      const bodyRows = table.querySelectorAll('tbody tr');
      const headH = head?.getBoundingClientRect().height ?? 0;

      let full = headH;
      for (let i = 0; i < bodyRows.length; i++) {
        full += bodyRows[i]!.getBoundingClientRect().height;
      }

      let collapsed = headH;
      const n = Math.min(collapsedCount, bodyRows.length);
      for (let i = 0; i < n; i++) {
        collapsed += bodyRows[i]!.getBoundingClientRect().height;
      }

      setCollapsedH(Math.max(collapsed, 80));
      setFullH(Math.max(full, collapsed));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [rowCount, collapsedCount]);

  const maxHeight = expanded ? fullH : collapsedH;
  return { wrapRef, maxHeight };
}
