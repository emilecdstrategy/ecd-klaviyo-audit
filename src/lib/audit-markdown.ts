/** Markdown-lite format used across audit copy: **bold**, *italic*, `type:entity`, newlines. */

import {
  ENTITY_CHIP_CLASS,
  ENTITY_LABELS,
  isInsideEntityMarkerAt,
  prepareAuditText,
  repairEntityMarkers,
  stripEntityMarkers,
  type EntityType,
} from './entity-tags';

const ENTITY_TYPES = ['flow', 'campaign', 'segment', 'form'] as const;

const INLINE_MARKDOWN_REGEX =
  /(`(flow|campaign|segment|form):([^`]+)`|\*\*([^*]+?)\*\*|\*([^*]+?)\*)/g;

export type InlineMarkdownToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'entity'; entityType: EntityType; name: string };

/** Fix legacy triple-asterisk bold markers (e.g. ***Why Upgrade:***) to standard **bold**. */
export function normalizeInlineMarkdown(text: string): string {
  if (!text) return text;

  return text.replace(/\*{3,}([^*\n]+?)\*{2,3}/g, '**$1**');
}

export function prepareAuditMarkdown(text: string): string {
  let result = normalizeInlineMarkdown(text || '');
  result = repairEntityMarkers(result);
  result = repairFlattenedMarkdown(result);
  return repairEntityMarkers(result);
}

export function tokenizeInlineMarkdown(text: string): InlineMarkdownToken[] {
  const normalized = normalizeInlineMarkdown(text);
  const tokens: InlineMarkdownToken[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  INLINE_MARKDOWN_REGEX.lastIndex = 0;
  while ((match = INLINE_MARKDOWN_REGEX.exec(normalized)) !== null) {
    if (match.index > last) {
      tokens.push({ type: 'text', value: normalized.slice(last, match.index) });
    }
    if (match[2] !== undefined && match[3] !== undefined) {
      tokens.push({ type: 'entity', entityType: match[2] as EntityType, name: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ type: 'bold', value: match[4] });
    } else if (match[5] !== undefined) {
      tokens.push({ type: 'italic', value: match[5] });
    }
    last = INLINE_MARKDOWN_REGEX.lastIndex;
  }

  if (last < normalized.length) {
    tokens.push({ type: 'text', value: normalized.slice(last) });
  }

  return tokens;
}

function entitySpan(type: EntityType, name: string): string {
  const safe = name
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const label = ENTITY_LABELS[type];
  return `<span data-entity-type="${type}" class="${ENTITY_CHIP_CLASS[type]}" title="${label}">${safe}</span>`;
}

export function mdToHtml(md: string): string {
  return markdownToEditorHtml(md);
}

function inlineMdToHtml(md: string): string {
  return tokenizeInlineMarkdown(md)
    .map(token => {
      switch (token.type) {
        case 'entity':
          return entitySpan(token.entityType, token.name);
        case 'bold':
          return `<strong>${token.value}</strong>`;
        case 'italic':
          return `<em>${token.value}</em>`;
        default:
          return token.value;
      }
    })
    .join('');
}

/** Repair legacy content where bullet lines were saved without newlines between them. */
export function repairFlattenedMarkdown(text: string): string {
  if (!text?.trim()) return text || '';
  const bulletMarkers = text.match(/- /g)?.length ?? 0;
  const newlines = text.match(/\n/g)?.length ?? 0;
  if (bulletMarkers < 2 && newlines > 0) return text;

  let repaired = text;
  if (bulletMarkers >= 2 && newlines < bulletMarkers) {
    repaired = repaired.replace(/([^\n])- (?=[A-Za-z*])/g, (match, before, offset, whole) => {
      const splitAt = offset + String(before).length;
      if (isInsideEntityMarkerAt(whole, splitAt)) return match;
      return `${before}\n- `;
    });
  }
  repaired = repaired.replace(/([a-z.])(ECD Pricing:)/gi, '$1\n\n$2');
  repaired = repaired.replace(/(ECD Pricing:)- (?=[A-Za-z*])/g, '$1\n- ');
  return repaired.replace(/\n{3,}/g, '\n\n').trim();
}

/** Convert markdown blocks to HTML for contentEditable editors (lists, paragraphs, inline bold). */
export function markdownToEditorHtml(md: string): string {
  const normalized = prepareAuditMarkdown(md);
  const blocks = parseRichAuditBlocks(normalized);
  if (!blocks.length) return inlineMdToHtml(normalized);

  return blocks
    .map(block => {
      if (block.type === 'list') {
        const items = block.items.map(item => `<li>${inlineMdToHtml(item)}</li>`).join('');
        return `<ul>${items}</ul>`;
      }
      return `<div>${inlineMdToHtml(block.text)}</div>`;
    })
    .join('');
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
    .map(bullet => `<li>${inlineMdToHtml(bullet)}</li>`);

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
    return markdownToEditorHtml(plain);
  }
  const processed = lookup?.size ? prepareAuditText(text || '', lookup, autoTag) : (text || '');
  return markdownToEditorHtml(processed);
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
    .replace(/<\/(div|p|h[1-6]|blockquote|section|article|header|footer|tr)>/gi, '\n')
    .replace(/<(div|p|h[1-6]|blockquote|section|article|header|footer|tr)(\s[^>]*)?>/gi, '\n')
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
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return repairEntityMarkers(normalizeInlineMarkdown(md));
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
