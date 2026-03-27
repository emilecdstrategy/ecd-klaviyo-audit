import React from 'react';

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
}: {
  text: string;
  className?: string;
}) {
  const paragraphs = (text || '')
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

