import React from 'react';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function autoBoldEntities(text: string, extraNames?: string[]): string {
  let result = text.replace(/\*\*(.+?)\*\*/g, '$1');

  const names: string[] = [];
  if (extraNames?.length) {
    for (const n of extraNames) {
      const trimmed = n.trim();
      if (trimmed.length >= 2) names.push(trimmed);
    }
  }

  names.sort((a, b) => b.length - a.length);

  for (const name of names) {
    const regex = new RegExp(`(?<!\\*\\*)\\b(${escapeRegex(name)})\\b(?!\\*\\*)`, 'gi');
    result = result.replace(regex, '**$1**');
  }
  return result;
}

function renderInlineBold(text: string) {
  const nodes: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(<strong key={`${match.index}-${match[1]}`}>{match[1]}</strong>);
    last = regex.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function RichAuditText({
  text,
  className,
  boldFlowNames = false,
  entityNames,
}: {
  text: string;
  className?: string;
  boldFlowNames?: boolean;
  entityNames?: string[];
}) {
  const processed = boldFlowNames ? autoBoldEntities(text || '', entityNames) : (text || '');
  const paragraphs = processed
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return null;

  return (
    <div className={className}>
      {paragraphs.map((p, i) => (
        <p key={`${i}-${p.slice(0, 12)}`} className={i > 0 ? 'mt-2' : ''}>
          {renderInlineBold(p)}
        </p>
      ))}
    </div>
  );
}

