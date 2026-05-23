import { type ReactNode, useState } from 'react';
import { ChevronRight, Table2 } from 'lucide-react';
import Modal from '../ui/Modal';

export default function ReportInventoryLauncher({
  title,
  subtitle,
  count,
  countLabel,
  modalTitle,
  modalSubtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  count: number;
  countLabel: string;
  modalTitle?: string;
  modalSubtitle?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const displayTitle = title || `Klaviyo ${countLabel} inventory`;
  const buttonLabel =
    count === 0
      ? `View ${countLabel} inventory`
      : count === 1
        ? `View 1 ${countLabel.replace(/s$/, '')}`
        : `View all ${count} ${countLabel}`;

  return (
    <>
      <div className="rounded-2xl border border-gray-100 bg-gradient-to-br from-brand-surface/80 to-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10">
              <Table2 className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900">{displayTitle}</h3>
              <p className="mt-0.5 text-sm text-gray-500">
                {subtitle ||
                  (count === 0
                    ? `No ${countLabel} were found in Klaviyo for this audit.`
                    : `${count} ${countLabel} pulled directly from Klaviyo for this audit.`)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-primary/20 transition-colors hover:bg-brand-primary-dark"
          >
            {buttonLabel}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={modalTitle || displayTitle}
        className="max-w-5xl"
      >
        <div className="border-b border-gray-50 px-5 py-3">
          <p className="text-sm text-gray-500">
            {modalSubtitle ||
              subtitle ||
              `Full inventory of ${countLabel} from this Klaviyo account at the time of the audit.`}
          </p>
        </div>
        <div className="overflow-x-auto p-5">{children}</div>
      </Modal>
    </>
  );
}
