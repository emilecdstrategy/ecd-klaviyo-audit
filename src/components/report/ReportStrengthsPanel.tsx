import { CheckCircle2 } from 'lucide-react';
import { RichAuditText } from '../ui/RichAuditText';

function parseStrengthLine(text: string) {
  const dashIdx = text.indexOf(' — ');
  if (dashIdx > 0) {
    return {
      lead: text.slice(0, dashIdx).replace(/\*\*(.+?)\*\*/g, '$1'),
      rest: text.slice(dashIdx + 3),
    };
  }
  return { lead: text.replace(/\*\*(.+?)\*\*/g, '$1'), rest: '' };
}

export default function ReportStrengthsPanel({
  title,
  strengths,
}: {
  title: string;
  strengths: string[];
}) {
  return (
    <div className="mb-8 overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-emerald-100/80 px-6 py-4">
        <CheckCircle2 className="h-5 w-5 text-emerald-600" strokeWidth={2.25} />
        <h3 className="text-base font-bold text-gray-900">{title}</h3>
      </div>
      <ul className="space-y-4 px-6 py-5">
        {strengths.length > 0 ? (
          strengths.map((s, i) => {
            const { lead, rest } = parseStrengthLine(s);
            return (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900">{lead}</span>
                  {rest && (
                    <RichAuditText text={rest} className="mt-1 block text-sm leading-relaxed text-gray-600" />
                  )}
                </span>
              </li>
            );
          })
        ) : (
          <li className="text-sm text-gray-500">AI overview not available for this audit run.</li>
        )}
      </ul>
    </div>
  );
}
