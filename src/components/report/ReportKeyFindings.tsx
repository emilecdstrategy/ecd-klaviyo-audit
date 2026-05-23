import { AlertCircle } from 'lucide-react';
import { RichAuditText } from '../ui/RichAuditText';
import ReportBlockHeader from './ReportBlockHeader';

export default function ReportKeyFindings({
  title,
  findings,
}: {
  title: string;
  findings: string[];
}) {
  return (
    <div className="mb-8 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <ReportBlockHeader
        icon={
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10">
            <AlertCircle className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
          </div>
        }
        title={title}
        subtitle="Priority gaps identified in your Klaviyo account"
        titleClassName="text-lg font-bold text-gray-900"
      />

      <ol className="divide-y divide-gray-100">
        {findings.slice(0, 5).map((finding, i) => (
          <li
            key={i}
            className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-4 px-6 py-5 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:gap-x-5 sm:py-6"
          >
            <span
              aria-hidden
              className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-primary-dark text-xs font-bold leading-none text-white tabular-nums shadow-md shadow-brand-primary/20"
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <RichAuditText
              text={finding}
              className="min-w-0 text-base leading-relaxed text-gray-700"
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
