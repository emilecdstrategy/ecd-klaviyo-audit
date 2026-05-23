import { AlertCircle } from 'lucide-react';
import { RichAuditText } from '../ui/RichAuditText';

export default function ReportKeyFindings({
  title,
  findings,
}: {
  title: string;
  findings: string[];
}) {
  return (
    <div className="mb-8 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gradient-to-r from-brand-surface to-white px-8 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-primary/10">
            <AlertCircle className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500">Priority gaps identified in your Klaviyo account</p>
          </div>
        </div>
      </div>

      <ol className="divide-y divide-gray-100">
        {findings.slice(0, 5).map((finding, i) => (
          <li key={i} className="flex items-start gap-5 px-8 py-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-primary-dark text-sm font-bold text-white tabular-nums shadow-md shadow-brand-primary/20">
              {String(i + 1).padStart(2, '0')}
            </span>
            <RichAuditText
              text={finding}
              className="text-base leading-relaxed text-gray-700 pt-1.5"
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
