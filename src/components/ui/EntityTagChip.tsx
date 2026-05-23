import { cn } from '../../lib/utils';
import { ENTITY_CHIP_CLASS, type EntityType } from '../../lib/entity-tags';

export default function EntityTagChip({
  type,
  name,
  className,
}: {
  type: EntityType;
  name: string;
  className?: string;
}) {
  return (
    <span className={cn(ENTITY_CHIP_CLASS[type], className)} data-entity-type={type}>
      {name}
    </span>
  );
}
