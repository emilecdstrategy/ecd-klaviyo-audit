import { FileCheck2 } from 'lucide-react';
import { RichAuditContent } from '../ui/RichAuditText';

type ProposalContractSectionProps = {
  name: string;
  /** Markdown rich text (live doc in draft, frozen snapshot once sent). */
  content: string;
  collapsible?: boolean;
  /** Anchor id so the acceptance checkbox can link to this document. */
  id?: string;
};

export default function ProposalContractSection({
  name,
  content,
  collapsible = false,
  id,
}: ProposalContractSectionProps) {
  const body = (
    <div className="mt-4 text-sm leading-relaxed text-gray-700 [&_ul]:list-disc [&_ul]:pl-5 space-y-3">
      {content.trim() ? (
        <RichAuditContent text={content} autoTagEntities={false} />
      ) : (
        <p className="text-gray-400 italic">
          This document has no content yet. Add it under Proposals → Contract Docs.
        </p>
      )}
    </div>
  );

  const header = (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 ring-1 ring-brand-primary/15">
        <FileCheck2 className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
      </div>
      <h2 className="text-lg font-bold text-gray-900">{name}</h2>
    </div>
  );

  if (collapsible) {
    return (
      <section id={id} className="proposal-section proposal-page-break scroll-mt-6 rounded-2xl border border-gray-100 bg-white px-6 py-5 shadow-sm">
        <details className="print:hidden [&[open]_span.disclosure]:hidden">
          <summary className="cursor-pointer list-none">
            {header}
            <span className="disclosure mt-2 inline-block text-xs font-medium text-brand-primary">
              Read full agreement
            </span>
          </summary>
          {body}
        </details>
        {/* Print always shows the full agreement even when collapsed on screen. */}
        <div className="hidden print:block">
          {header}
          {body}
        </div>
      </section>
    );
  }

  return (
    <section id={id} className="proposal-section proposal-page-break scroll-mt-6 rounded-2xl border border-gray-100 bg-white px-6 py-5 shadow-sm">
      {header}
      {body}
    </section>
  );
}
