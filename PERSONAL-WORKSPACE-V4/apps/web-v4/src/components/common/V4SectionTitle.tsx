import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type V4SectionTitleTone =
  'scope' | 'deliverables' | 'requirements' | 'notes' | 'summary' | 'neutral';

export interface V4SectionTitleProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: V4SectionTitleTone;
  headingId?: string;
  headingLevel?: 2 | 3;
  className?: string;
}

/** A compact, semantic heading for a V4 card or section. */
export function V4SectionTitle({
  icon: Icon,
  title,
  description,
  action,
  tone = 'neutral',
  headingId,
  headingLevel = 2,
  className,
}: V4SectionTitleProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <header className={`v4-section-title${className ? ` ${className}` : ''}`} data-tone={tone}>
      <Icon className="v4-section-title__icon" aria-hidden="true" strokeWidth={1.8} />
      <div className="v4-section-title__copy">
        <Heading id={headingId} className="v4-section-title__heading">
          {title}
        </Heading>
        {description ? <p className="v4-section-title__description">{description}</p> : null}
      </div>
      {action ? <div className="v4-section-title__action">{action}</div> : null}
    </header>
  );
}
