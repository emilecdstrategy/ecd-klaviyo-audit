import AnnotationLayer from './AnnotationLayer';
import type { Annotation, AuditAsset } from '../../lib/types';

interface SideBySideComparisonProps {
  currentAsset?: AuditAsset;
  optimizedAsset?: AuditAsset;
  currentAnnotations: Annotation[];
  optimizedAnnotations: Annotation[];
  currentTitle?: string;
  optimizedTitle?: string;
  onAddAnnotation?: (side: 'current' | 'optimized', x: number, y: number, label: string) => void;
  onRemoveAnnotation?: (id: string) => void;
  editable?: boolean;
}

export default function SideBySideComparison({
  currentAsset,
  optimizedAsset,
  currentAnnotations,
  optimizedAnnotations,
  currentTitle = 'Current State',
  optimizedTitle = 'Optimized State',
  onAddAnnotation,
  onRemoveAnnotation,
  editable = false,
}: SideBySideComparisonProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <h4 className="text-sm font-semibold text-gray-800">{currentTitle}</h4>
        </div>
        {currentAsset ? (
          <AnnotationLayer
            imageUrl={currentAsset.file_url}
            annotations={currentAnnotations}
            onAddAnnotation={
              editable && onAddAnnotation
                ? (x, y, label) => onAddAnnotation('current', x, y, label)
                : undefined
            }
            onRemoveAnnotation={editable ? onRemoveAnnotation : undefined}
            editable={editable}
            side="current"
          />
        ) : (
          <div className="aspect-video bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center">
            <p className="text-sm text-gray-400">No screenshot uploaded</p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <h4 className="text-sm font-semibold text-gray-800">{optimizedTitle}</h4>
        </div>
        {optimizedAsset ? (
          <AnnotationLayer
            imageUrl={optimizedAsset.file_url}
            annotations={optimizedAnnotations}
            onAddAnnotation={
              editable && onAddAnnotation
                ? (x, y, label) => onAddAnnotation('optimized', x, y, label)
                : undefined
            }
            onRemoveAnnotation={editable ? onRemoveAnnotation : undefined}
            editable={editable}
            side="optimized"
          />
        ) : (
          <div className="aspect-video bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center">
            <p className="text-sm text-gray-400">No benchmark example selected</p>
          </div>
        )}
      </div>
    </div>
  );
}
