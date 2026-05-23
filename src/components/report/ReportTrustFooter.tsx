import { ExternalLink } from 'lucide-react';
import ReportBrandMark from './ReportBrandMark';

const TRUST_BULLETS = [
  'Klaviyo Platinum partner expertise',
  'Clear next steps, not generic checklists',
  'Revenue-focused lifecycle strategy',
];

export default function ReportTrustFooter({ preparedDate }: { preparedDate: string }) {
  return (
    <footer className="mt-16 border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-[90rem] px-6 py-12">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-start">
          <div>
            <ReportBrandMark size="md" />
            <p className="mt-4 max-w-md text-sm leading-relaxed text-gray-600">
              ECD Digital Strategy is a revenue-focused e-commerce marketing agency helping DTC brands
              grow through email, SMS, and conversion optimization.
            </p>
            <ul className="mt-5 space-y-2">
              {TRUST_BULLETS.map(item => (
                <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-brand-primary/15 bg-brand-surface p-6">
            <p className="text-sm font-semibold text-gray-900">Ready to turn this audit into action?</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Book a strategy call with our team to prioritize fixes and scale Klaviyo revenue.
            </p>
            <a
              href="https://www.ecdigitalstrategy.com/book-your-free-audit/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-primary/25 transition-colors hover:bg-brand-primary-dark"
            >
              Book Your Free Audit
              <ExternalLink className="h-4 w-4" strokeWidth={2.25} />
            </a>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-gray-100 pt-6 text-xs text-gray-400 sm:flex-row sm:items-center sm:justify-between">
          <p>Report prepared {preparedDate}</p>
          <p>© {new Date().getFullYear()} ECD Digital Strategy. Confidential client deliverable.</p>
        </div>
      </div>
    </footer>
  );
}
