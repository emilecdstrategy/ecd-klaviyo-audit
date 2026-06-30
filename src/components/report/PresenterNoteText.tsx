import { usePlatformSettings } from '../../contexts/PlatformSettingsContext';
import { cn } from '../../lib/utils';
import { useReportEntities } from './edit/ReportEntityContext';
import { renderInlineMarkdown } from '../ui/RichAuditText';

export default function PresenterNoteText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { entityLookup, autoTagEntities } = useReportEntities();
  const { entityHighlightsEnabled } = usePlatformSettings();

  return (
    <span className={cn('whitespace-pre-wrap', className)}>
      {renderInlineMarkdown(text, entityLookup, autoTagEntities, entityHighlightsEnabled)}
    </span>
  );
}
