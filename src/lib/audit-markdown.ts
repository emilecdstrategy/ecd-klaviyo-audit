/** Markdown-lite format used across audit copy: **bold**, *italic*, `type:entity`, newlines. */

import { ENTITY_CHIP_CLASS, type EntityType } from './entity-tags';

const ENTITY_TYPES = ['flow', 'campaign', 'segment', 'form'] as const;

function entitySpan(type: EntityType, name: string): string {
  const safe = name
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<span data-entity-type="${type}" class="${ENTITY_CHIP_CLASS[type]}">${safe}</span>`;
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

  return md;
}

export function hasRichAuditMarkup(text: string): boolean {
  if (/(<(b|strong|i|em|u|span)[>\s/])/i.test(text)) return true;
  if (/(\*\*|__|\*|_|~~)/.test(text)) return true;
  if (new RegExp(`\`(${ENTITY_TYPES.join('|')}):`).test(text)) return true;
  return false;
}
