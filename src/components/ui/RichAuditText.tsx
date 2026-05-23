import type { ReactNode } from 'react';
import { prepareAuditText, type EntityType } from '../../lib/entity-tags';
import { useReportEntities } from '../report/edit/ReportEntityContext';
import EntityTagChip from './EntityTagChip';

/** Renders inline **bold**, *italic*, and `type:entity` markers. */
export function renderInlineMarkdown(
  text: string,
  lookup?: Map<string, EntityType>,
  autoTag = true,
): ReactNode[] {
  const processed = lookup?.size ? prepareAuditText(text, lookup, autoTag) : text;
  const nodes: ReactNode[] = [];
  const regex = /(`(flow|campaign|segment|form):([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(processed)) !== null) {
    if (match.index > last) nodes.push(processed.slice(last, match.index));
    if (match[2] !== undefined && match[3] !== undefined) {
      nodes.push(
        <EntityTagChip key={key++} type={match[2] as EntityType} name={match[3]} />,
      );
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
}: {
  text: string;
  className?: string;
  entityLookup?: Map<string, EntityType>;
  autoTagEntities?: boolean;
}) {
  const { entityLookup: ctxLookup, autoTagEntities: ctxAutoTag } = useReportEntities();
  const entityLookup = entityLookupProp ?? ctxLookup;
  const autoTagEntities = autoTagProp ?? ctxAutoTag;
  const paragraphs = (text || '')
    .split('\n')
    .map(p => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return null;

  return (
    <div className={className}>
      {paragraphs.map((p, i) => (
        <p key={`${i}-${p.slice(0, 12)}`} className={i > 0 ? 'mt-2' : ''}>
          {renderInlineMarkdown(p, entityLookup, autoTagEntities)}
        </p>
      ))}
    </div>
  );
}

// Re-export for backward compatibility — boldFlowNames replaced by entity chips.
export { prepareAuditText, type EntityType } from '../../lib/entity-tags';
