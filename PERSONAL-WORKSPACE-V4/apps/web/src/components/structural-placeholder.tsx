import { EmptyState, SectionHeading } from './ui';

interface StructuralPlaceholderProps {
  title: string;
  detail?: string;
}

/**
 * Restrained structural placeholder for approved destinations that do not yet
 * have an independent page composition. It deliberately contains no fabricated
 * project data or metrics; deeper per-page composition is P2-UX-04.
 */
export function StructuralPlaceholder({ title, detail }: StructuralPlaceholderProps) {
  return (
    <section className="structural-placeholder" aria-label={title}>
      <SectionHeading title={title} {...(detail ? { detail } : {})} />
      <EmptyState
        title="This workspace area is being composed"
        description="Its navigation destination is established here. The full page composition lands in the P2-UX-04 project workspace pass."
      />
    </section>
  );
}
