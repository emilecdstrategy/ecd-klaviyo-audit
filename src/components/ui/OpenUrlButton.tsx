import { ExternalLink } from 'lucide-react';

/** The href for a URL a human typed, or null when there is nothing to open.
 *
 * Fields here are filled by hand and by detection, so the value can be blank
 * (the cart URL usually is), protocol-less ("store.com"), or half-typed. Only a
 * value that parses into a real host earns the affordance: an icon that opens
 * nothing is worse than no icon. */
function toHref(raw: string): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    // "https://foo" parses fine and goes nowhere useful.
    if (!url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

type OpenUrlButtonProps = {
  /** The URL as it stands in the field. Blank or unparseable renders nothing. */
  url: string;
  /** Tooltip and accessible label. */
  label?: string;
};

/**
 * A quiet "open this in a new tab" affordance that sits INSIDE a URL input, with
 * a branded tooltip on hover.
 *
 * Place it in a `relative` wrapper alongside the input, and give the input room
 * on the right (pr-9) so typed text never runs underneath it.
 */
export function OpenUrlButton({ url, label = 'Open this page in a new tab' }: OpenUrlButtonProps) {
  const href = toHref(url);
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      // Keep the click from stealing the caret into the field behind it.
      onMouseDown={e => e.preventDefault()}
      // A NAMED group, not a bare one. `group-hover:` matches any ancestor
      // carrying `.group`, and these inputs sit inside a <details> that has it,
      // so hovering one icon lit up every tooltip in the panel at once. Naming
      // the group ties the tooltip to its own anchor and nothing else.
      className="group/openurl absolute right-1.5 top-1/2 z-10 -translate-y-1/2 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-brand-primary/10 hover:text-brand-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/30"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 whitespace-nowrap rounded-lg bg-brand-navy px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/openurl:opacity-100 group-focus-visible/openurl:opacity-100"
      >
        {label}
        {/* The little pointer, sharing the tooltip's colour so it reads as one shape. */}
        <span className="absolute right-3 top-full -mt-1 h-2 w-2 rotate-45 bg-brand-navy" />
      </span>
    </a>
  );
}
