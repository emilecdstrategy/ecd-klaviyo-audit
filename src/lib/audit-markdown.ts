/** Markdown-lite format used across audit copy: **bold**, *italic*, `type:entity`, newlines. */

import {
  ENTITY_CHIP_CLASS,
  ENTITY_LABELS,
  prepareAuditText,
  repairEntityMarkers,
  stripEntityMarkers,
  type EntityType,
} from './entity-tags';

const ENTITY_TYPES = ['flow', 'campaign', 'segment', 'form'] as const;

function entitySpan(type: EntityType, name: string): string {
  const safe = name
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const label = ENTITY_LABELS[type];
  return `<span data-entity-type="${type}" class="${ENTITY_CHIP_CLASS[type]}" title="${label}">${safe}</span>`;
}

export function mdToHtml(md: string): string {
  let html = md;

  html = html.replace(/`(flow|campaign|segment|form):([^`]+)`/g, (_, type: EntityType, name: string) =>
    entitySpan(type, name),
  );

  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');

  return html;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function inlineHtmlToMd(html: string): string {
  let md = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<u>(.*?)<\/u>/gi, '$1')
    .replace(/<[^>]+>/g, '');

  return decodeHtmlEntities(md);
}

/** Render a bullet string array as HTML for rich editors (admin templates). */
export function bulletsArrayToEditorHtml(bullets: string[]): string {
  const items = bullets
    .map(v => v.trim())
    .filter(Boolean)
    .map(bullet => `<li>${mdToHtml(bullet)}</li>`);

  if (!items.length) return '';
  return `<ul>${items.join('')}</ul>`;
}

/** Parse rich-editor output back into a bullet string array. */
export function editorValueToBulletsArray(value: string): string[] {
  if (!value.trim()) return [];

  if (/<li[\s>]/i.test(value)) {
    return [...value.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map(match => inlineHtmlToMd(match[1]).trim())
      .filter(Boolean);
  }

  return value
    .split('\n')
    .map(line => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
}

export function auditTextToEditorHtml(
  text: string,
  lookup?: Map<string, EntityType>,
  autoTag = true,
  highlightsEnabled = true,
): string {
  if (!highlightsEnabled) {
    const plain = lookup?.size
      ? stripEntityMarkers(prepareAuditText(text || '', lookup, false))
      : stripEntityMarkers(text || '');
    return mdToHtml(plain);
  }
  const processed = lookup?.size ? prepareAuditText(text || '', lookup, autoTag) : (text || '');
  return mdToHtml(processed);
}

export function htmlToMd(html: string): string {
  let md = html;

  md = md.replace(
    /<span[^>]*data-entity-type="(flow|campaign|segment|form)"[^>]*>([\s\S]*?)<\/span>/gi,
    (_, type: EntityType, inner: string) => {
      const name = inner
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .trim();
      return `\`${type}:${name}\``;
    },
  );

  md = md.replace(
    /<ul[^>]*>([\s\S]*?)<\/ul>/gi,
    (_, inner: string) =>
      [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map(match => `- ${inlineHtmlToMd(match[1]).trim()}`)
        .join('\n'),
  );

  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => `- ${inlineHtmlToMd(inner).trim()}\n`);

  md = md
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<u>(.*?)<\/u>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

  return repairEntityMarkers(md);
}

export type RichAuditBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

/** Split markdown into paragraphs and bullet lists (lines starting with `- `). */
export function parseRichAuditBlocks(text: string): RichAuditBlock[] {
  const blocks: RichAuditBlock[] = [];
  let listItems: string[] | null = null;

  const flushList = () => {
    if (listItems?.length) {
      blocks.push({ type: 'list', items: listItems });
      listItems = null;
    }
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      if (!listItems) listItems = [];
      listItems.push(line.replace(/^[-*•]\s+/, '').trim());
      continue;
    }
    flushList();
    blocks.push({ type: 'paragraph', text: line });
  }

  flushList();
  return blocks;
}

export function hasRichAuditMarkup(text: string): boolean {
  if (/(<(b|strong|i|em|u|span)[>\s/])/i.test(text)) return true;
  if (/(\*\*|__|\*|_|~~)/.test(text)) return true;
  if (new RegExp(`\`(${ENTITY_TYPES.join('|')}):`).test(text)) return true;
  return false;
}
