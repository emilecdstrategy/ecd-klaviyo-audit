import type { NavigateFunction } from 'react-router-dom';

/**
 * Handlers that make a clickable table row behave like a real link.
 *
 * A row wired only to onClick loses everything the browser gives a link for
 * free: a middle click never fires onClick at all (it fires auxclick), so
 * opening a row in a background tab silently did nothing, and ctrl/cmd-click
 * navigated in place instead of opening a new tab.
 *
 * Spread onto the <tr>. Inner controls that call stopPropagation keep working.
 */
export function rowNavProps(
  to: string,
  navigate: NavigateFunction,
  opts?: { disabled?: boolean },
): {
  onClick: (e: React.MouseEvent) => void;
  onAuxClick: (e: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
} {
  const disabled = Boolean(opts?.disabled);
  const openInNewTab = () => window.open(to, '_blank', 'noopener,noreferrer');

  return {
    onClick: (e) => {
      if (disabled || e.defaultPrevented) return;
      // Same modifiers a link honours.
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        e.preventDefault();
        openInNewTab();
        return;
      }
      navigate(to);
    },
    onAuxClick: (e) => {
      if (disabled || e.defaultPrevented) return;
      if (e.button === 1) {
        e.preventDefault();
        openInNewTab();
      }
    },
    // Middle mouse down otherwise starts the browser's autoscroll mode, which
    // leaves the pointer stuck in scroll cursor after the tab opens.
    onMouseDown: (e) => {
      if (!disabled && e.button === 1) e.preventDefault();
    },
  };
}
