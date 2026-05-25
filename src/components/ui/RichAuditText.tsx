import type { ReactNode } from 'react';
import { parseRichAuditBlocks } from '../../lib/audit-markdown';
import { prepareAuditText, type EntityType } from '../../lib/entity-tags';
import { useReportEntities } from '../report/edit/ReportEntityContext';
import EntityTagChip from './EntityTagChip';
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext';

/** Renders inline **bold**, *italic*, and `type:entity` markers. */
export function renderInlineMarkdown(
  text: string,
  lookup?: Map<string, EntityType>,
  autoTag = true,
  highlightsEnabled = true,
): ReactNode[] {
  const processed = lookup?.size && highlightsEnabled
    ? prepareAuditText(text, lookup, autoTag)
    : lookup?.size && !highlightsEnabled
      ? prepareAuditText(text, lookup, false)
      : text;
  const nodes: ReactNode[] = [];
  const regex = /(`(flow|campaign|segment|form):([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(processed)) !== null) {
    if (match.index > last) nodes.push(processed.slice(last, match.index));
    if (match[2] !== undefined && match[3] !== undefined) {
      if (highlightsEnabled) {
        nodes.push(
          <EntityTagChip key={key++} type={match[2] as EntityType} name={match[3]} />,
        );
      } else {
        nodes.push(match[3]);
      }
    } else if (match[4] !== undefined) {
      nodes.push(<strong key={key++}>{match[4]}</strong>);
    } else if (match[5] !== undefined) {
      nodes.push(<em key={key++}>{match[5]}</em>);
    }
    last = regex.lastIndex;
  }

  if (last < processed.length) nodes.push(processed.slice(last));
  return nodes;
}

export function RichAuditText({
  text,
  className,
  entityLookup: entityLookupProp,
  autoTagEntities: autoTagProp,
  highlightsEnabled: highlightsEnabledProp,
}: {
  text: string;
  className?: string;
  entityLookup?: Map<string, EntityType>;
  autoTagEntities?: boolean;
  highlightsEnabled?: boolean;
}) {
  const { entityLookup: ctxLookup, autoTagEntities: ctxAutoTag } = useReportEntities();
  const { entityHighlightsEnabled } = usePlatformSettings();
  const entityLookup = entityLookupProp ?? ctxLookup;
  const autoTagEntities = autoTagProp ?? ctxAutoTag;
  const highlightsEnabled = highlightsEnabledProp ?? entityHighlightsEnabled;
  const paragraphs = (text || '')
    .split('\n')
    .map(p => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return null;

  return (
    <div className={className}>
      {paragraphs.map((p, i) => (
        <p key={`${i}-${p.slice(0, 12)}`} className={i > 0 ? 'mt-2' : ''}>
          {renderInlineMarkdown(p, entityLookup, autoTagEntities, highlightsEnabled)}
        </p>
      ))}
    </div>
  );
}

/** Renders markdown with optional bullet lists (`- item`) and paragraphs. */
export function RichAuditContent({
  text,
  className,
  listClassName = 'list-disc pl-5 space-y-2 marker:text-brand-primary',
  itemClassName = 'text-sm leading-relaxed text-gray-700',
  paragraphClassName,
  entityLookup: entityLookupProp,
  autoTagEntities: autoTagProp,
  highlightsEnabled: highlightsEnabledProp,
}: {
  text: string;
  className?: string;
  listClassName?: string;
  itemClassName?: string;
  paragraphClassName?: string;
  entityLookup?: Map<string, EntityType>;
  autoTagEntities?: boolean;
  highlightsEnabled?: boolean;
}) {
  const { entityLookup: ctxLookup, autoTagEntities: ctxAutoTag } = useReportEntities();
  const { entityHighlightsEnabled } = usePlatformSettings();
  const entityLookup = entityLookupProp ?? ctxLookup;
  const autoTagEntities = autoTagProp ?? ctxAutoTag;
  const highlightsEnabled = highlightsEnabledProp ?? entityHighlightsEnabled;
  const blocks = parseRichAuditBlocks(text || '');

  if (!blocks.length) return null;

  return (
    <div className={className}>
      {blocks.map((block, blockIndex) => {
        if (block.type === 'list') {
          return (
            <ul
              key={`list-${blockIndex}`}
              className={[listClassName, blockIndex > 0 ? 'mt-3' : ''].filter(Boolean).join(' ')}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${blockIndex}-${itemIndex}`} className={itemClassName}>
                  {renderInlineMarkdown(item, entityLookup, autoTagEntities, highlightsEnabled)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p
            key={`p-${blockIndex}`}
            className={[paragraphClassName ?? itemClassName, blockIndex > 0 ? 'mt-3' : ''].filter(Boolean).join(' ')}
          >
            {renderInlineMarkdown(block.text, entityLookup, autoTagEntities, highlightsEnabled)}
          </p>
        );
      })}
    </div>
  );
}

// Re-export for backward compatibility — boldFlowNames replaced by entity chips.
export { prepareAuditText, type EntityType } from '../../lib/entity-tags';
