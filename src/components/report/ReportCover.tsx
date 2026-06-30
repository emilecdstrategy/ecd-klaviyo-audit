import type { ReactNode } from 'react';
import ReportBrandMark from './ReportBrandMark';
import SiteFavicon from '../ui/SiteFavicon';

export default function ReportCover({
  companyName,
  preparedDate,
  websiteUrl,
  identifiedOpportunity,
}: {
  companyName: string;
  preparedDate: string;
  websiteUrl?: string | null;
  identifiedOpportunity?: ReactNode;
}) {
  return (
    <div className="relative mb-10 overflow-hidden rounded-3xl text-white shadow-xl shadow-brand-primary/15 ring-1 ring-white/10">
      <div
        className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-primary-dark to-brand-primary"
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-white/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-20 -left-16 h-64 w-64 rounded-full bg-brand-primary-light/30 blur-3xl" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(255,255,255,0.14),transparent)]"
        aria-hidden
      />

      <div className="relative px-8 py-8 sm:px-12 sm:py-10 lg:px-14 lg:py-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <ReportBrandMark size="lg" inverted subtitle="Klaviyo Email Audit Report" />

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm sm:shrink-0 sm:justify-end sm:text-right">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Report date</p>
              <p className="mt-0.5 font-medium text-white/90">{preparedDate}</p>
            </div>
            <div className="hidden h-8 w-px bg-white/15 sm:block" aria-hidden />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Deliverable</p>
              <p className="mt-0.5 font-medium text-white/90">Klaviyo Lifecycle Audit</p>
            </div>
          </div>
        </div>

        <div className="mt-8 max-w-3xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/60 mb-3">
            Prepared for
          </p>
          <h1 className="flex items-center gap-2.5 sm:gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
            <SiteFavicon url={websiteUrl} size="md" variant="onDark" className="shrink-0" />
            <span>{companyName}</span>
          </h1>
          <p className="mt-4 text-base leading-relaxed text-white/80 sm:text-lg max-w-2xl">
            A strategic review of your Klaviyo account. What&apos;s working, what needs attention,
            and where revenue is being left on the table.
          </p>
        </div>

        {identifiedOpportunity}
      </div>
    </div>
  );
}
