import { ZoomIn, ExternalLink, Play, Star } from 'lucide-react';
import type { AddOnPricingSlice } from '../../lib/addon-pricing';
import { formatAddOnPrice } from '../../lib/addon-pricing';
import { cn } from '../../lib/utils';
import { addOnHasCustomerAgentDemo } from '../../lib/customer-agent-demo';
import EditablePlainText from './edit/EditablePlainText';
import EditableRichText from './edit/EditableRichText';
import EditableCurrency from './edit/EditableCurrency';
import { useReportEdit } from './edit/ReportEditContext';
import ImageUploadZone from '../ui/ImageUploadZone';
import ResizableReportImage from '../ui/ResizableReportImage';

type ReportAddOnCardProps = {
  slice: AddOnPricingSlice;
  customerAgentDemoUrl: string | null;
  uploadingAddOnKey: string | null;
  onImageUpload: (itemKey: string, file: File | undefined) => void;
  onLightbox: (src: string) => void;
  onDemoOpen: (url: string, title: string) => void;
  updateAddOnField: (itemKey: string, field: 'name' | 'description' | 'details_url', value: string) => void;
  updateAddOnContent: (itemKey: string, value: string) => void;
  updateAddOnImage: (itemKey: string, value: string | null) => void;
  updateAddOnPrice: (
    itemKey: string,
    field: 'one_time_price' | 'one_time_label' | 'monthly_price' | 'monthly_label',
    value: number | string | null,
  ) => void;
};

function AddOnPriceBlock({
  slice,
  itemKey,
  editMode,
  priceDisplay,
  amountField,
  labelField,
  updateAddOnPrice,
}: {
  slice: AddOnPricingSlice;
  itemKey: string;
  editMode: boolean;
  priceDisplay: ReturnType<typeof formatAddOnPrice>;
  amountField: 'one_time_price' | 'monthly_price';
  labelField: 'one_time_label' | 'monthly_label';
  updateAddOnPrice: ReportAddOnCardProps['updateAddOnPrice'];
}) {
  return (
    <div className="inline-flex min-w-[12.5rem] max-w-[14.5rem] flex-col items-start rounded-xl bg-indigo-50 px-3.5 py-2 ring-1 ring-indigo-100">
      {editMode ? (
        <>
          <div className="flex items-baseline gap-0.5">
            <EditableCurrency
              value={slice.amount ?? 0}
              onSave={v => updateAddOnPrice(itemKey, amountField, v)}
              variant="compact"
              inputWidthScale={2.5}
              className="text-sm font-bold text-indigo-800 tabular-nums"
            />
            {slice.unit === 'monthly' && (
              <span className="text-[11px] font-semibold text-indigo-600">/mo</span>
            )}
          </div>
          <EditablePlainText
            value={slice.label ?? ''}
            onSave={v => updateAddOnPrice(itemKey, labelField, v.trim() || null)}
            className="mt-1 w-full text-[10px] leading-snug text-indigo-600"
            as="p"
            placeholder={slice.unit === 'monthly' ? 'Price note…' : 'Tier / range note…'}
          />
        </>
      ) : (
        <>
          <span className="whitespace-nowrap text-sm font-bold tabular-nums text-indigo-900">
            {priceDisplay.headline}
            {slice.unit === 'monthly' && slice.amount != null && slice.amount > 0 && !slice.label?.includes('/mo') ? (
              <span className="text-[11px] font-semibold text-indigo-600">/mo</span>
            ) : null}
          </span>
          {priceDisplay.caption ? (
            <span className="mt-1 block text-[10px] leading-snug text-indigo-600">{priceDisplay.caption}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function ReportAddOnCard({
  slice,
  customerAgentDemoUrl,
  uploadingAddOnKey,
  onImageUpload,
  onLightbox,
  onDemoOpen,
  updateAddOnField,
  updateAddOnContent,
  updateAddOnImage,
  updateAddOnPrice,
}: ReportAddOnCardProps) {
  const { editMode, updateAddOnImageScale } = useReportEdit();
  const item = slice.item;
  const itemKey = `${item.template_slug}-${item.display_order}`;
  const showDemoCta = addOnHasCustomerAgentDemo(item.template_slug) && Boolean(customerAgentDemoUrl);
  const priceDisplay = formatAddOnPrice(slice.amount, slice.label, slice.unit);
  const amountField = slice.unit === 'one_time' ? 'one_time_price' : 'monthly_price';
  const labelField = slice.unit === 'one_time' ? 'one_time_label' : 'monthly_label';

  const showPriceBlock =
    editMode || (slice.amount != null && slice.amount > 0) || Boolean(priceDisplay.headline);
  const showCtaColumn = showDemoCta || Boolean(item.details_url?.trim()) || editMode;
  const showFooter = showPriceBlock || showCtaColumn;

  const isHighlighted = Boolean(item.highlighted);

  return (
    <div
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg',
        isHighlighted
          ? 'border-amber-300/70 ring-2 ring-amber-200/60 hover:border-amber-400 hover:shadow-amber-100/50'
          : 'border-gray-200 hover:border-brand-primary/30 hover:shadow-brand-primary/5',
      )}
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2.5 min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {isHighlighted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                <Star className="h-3 w-3 fill-amber-600 text-amber-600" />
                Highlighted
              </span>
            )}
          </div>
          <EditablePlainText
            value={item.name}
            onSave={v => updateAddOnField(itemKey, 'name', v)}
            className="text-[15px] font-bold leading-snug text-gray-900"
            as="h4"
          />
          <EditablePlainText
            value={item.description || ''}
            onSave={v => updateAddOnField(itemKey, 'description', v)}
            className="text-xs text-gray-500 mt-0.5"
            as="p"
            placeholder="Short description…"
          />
        </div>

        {item.content && (
          <EditableRichText
            value={item.content}
            onSave={v => updateAddOnContent(itemKey, v)}
            className="text-sm leading-relaxed text-gray-700"
          />
        )}

        {editMode ? (
          <div className="mt-4">
            <ImageUploadZone
              previewUrl={item.image_url}
              previewAlt={`${item.name} screenshot`}
              label="Add screenshot"
              uploading={uploadingAddOnKey === itemKey}
              onFile={file => onImageUpload(itemKey, file)}
              onRemove={item.image_url ? () => updateAddOnImage(itemKey, null) : undefined}
              onPreviewClick={item.image_url ? () => onLightbox(item.image_url ?? '') : undefined}
              imageScale={item.image_scale}
              onImageScaleChange={scale => updateAddOnImageScale(itemKey, scale)}
              resizable={Boolean(item.image_url)}
              className="rounded-lg"
            />
          </div>
        ) : item.image_url ? (
          <div className="group relative mt-4">
            <ResizableReportImage
              src={item.image_url}
              alt={item.name}
              scale={item.image_scale}
              onClick={() => onLightbox(item.image_url ?? '')}
              imageClassName="rounded-lg"
            />
            <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
              <ZoomIn className="h-3 w-3" /> View full size
            </span>
          </div>
        ) : null}

        {showFooter && (
          <div
            className={cn(
              'mt-4 flex items-center gap-4 border-t border-gray-100 pt-4',
              showPriceBlock && showCtaColumn ? 'justify-between' : showCtaColumn ? 'justify-end' : 'justify-start',
            )}
          >
            {showPriceBlock ? (
              <AddOnPriceBlock
                slice={slice}
                itemKey={itemKey}
                editMode={editMode}
                priceDisplay={priceDisplay}
                amountField={amountField}
                labelField={labelField}
                updateAddOnPrice={updateAddOnPrice}
              />
            ) : null}

            {showCtaColumn ? (
              <div className="flex min-w-0 flex-col items-end justify-center gap-2">
                {editMode && (
                  <EditablePlainText
                    value={item.details_url ?? ''}
                    onSave={v => updateAddOnField(itemKey, 'details_url', v)}
                    className="w-full min-w-[12rem] text-right text-xs text-gray-500"
                    as="p"
                    placeholder="Details doc URL (opens in new tab)…"
                  />
                )}
                {showDemoCta && customerAgentDemoUrl && (
                  <button
                    type="button"
                    onClick={() => onDemoOpen(customerAgentDemoUrl, item.name)}
                    className="inline-flex items-center gap-1.5 rounded-lg gradient-bg px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                  >
                    <Play className="h-3.5 w-3.5 shrink-0 fill-current" aria-hidden />
                    View live demo
                  </button>
                )}
                {item.details_url?.trim() && (
                  <a
                    href={item.details_url.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:border-brand-primary/30 hover:bg-white hover:text-brand-primary"
                  >
                    View more details
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                  </a>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
