/**
 * Generate Output entry-point (V4-REVISIONS-OUTPUTS-GENERATE-OUTPUT-ENTRY-01).
 *
 * This is a NAVIGATION-ONLY primary CTA for the Revisions & Outputs workspace.
 * It opens a compact anchored menu listing the two owning output workspaces
 * (Luminaire Schedule, Technical BOQ) and navigates to the canonical route for
 * the SAME projectId. It never invokes a generation or recovery mutation — that
 * authority stays in the owning workspaces. No template, revision, columns,
 * paper-size, or format controls live here.
 *
 * C1 adds ONE optional behaviour and no new items: when the caller supplies an
 * eligible composition target, the SAME two destinations are navigated to with
 * `?targetRevisionId=` appended. The route patterns are unchanged and the menu
 * still lists exactly Luminaire Schedule and Technical BOQ.
 *
 * PACKAGES-E2E-01 — the composition target is now EXPLICIT and never inferred by
 * sequence. The menu receives the full set of PREPARING composed Revisions
 * (`composableTargets`) and:
 *   - defaults to the single composable target when exactly one exists,
 *   - lets the Owner select the exact UUID when several exist,
 *   - shows truthful guidance and disables navigation when NO PREPARING target
 *     exists (no silent standalone fallback, no implicit Revision creation).
 * The selected target travels in the query string (`?targetRevisionId=`), which
 * remains the single authority for the owning workspace.
 */
import { ChevronDown, FileOutput } from '../../components/common/SctIcons';
import {
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { generatePath, useNavigate } from 'react-router-dom';
import type { CanonicalRevisionRecord } from '@scli/domain';
import { v4SemanticIcons } from '../../components/common/V4SemanticIcons';
import { targetRevisionSearch } from '../../components/revisions/targetRevisionUrl';
import { ROUTE_PROJECT_LUMINAIRE_SCHEDULE, ROUTE_PROJECT_TECHNICAL_BOQ } from '../../router/routes';
import { V4AnchoredSurface } from '../../components/interaction/V4AnchoredSurface';

interface GenerateOutputOption {
  key: 'schedule' | 'boq';
  label: string;
  caption: string;
  route: string;
  icon: typeof v4SemanticIcons.luminaireSchedule;
  testId: string;
}

const OPTIONS: readonly GenerateOutputOption[] = [
  {
    key: 'schedule',
    label: 'Luminaire Schedule',
    caption: 'Open the Luminaire Schedule workspace to configure and generate PDF / XLSX outputs.',
    route: ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
    icon: v4SemanticIcons.luminaireSchedule,
    testId: 'v4-generate-output-option-schedule',
  },
  {
    key: 'boq',
    label: 'Technical BOQ',
    caption: 'Open the Technical BOQ workspace to configure and generate PDF / XLSX outputs.',
    route: ROUTE_PROJECT_TECHNICAL_BOQ,
    icon: v4SemanticIcons.technicalBOQ,
    testId: 'v4-generate-output-option-boq',
  },
];

export interface GenerateOutputMenuProps {
  projectId: string;
  triggerStyle?: CSSProperties;
  triggerContent?: ReactNode;
  /**
   * The full set of PREPARING composed Revisions that may currently receive a
   * generated Output. The menu derives the target from this set — never from a
   * display sequence. When exactly one exists it is the default; when several
   * exist the Owner selects the exact UUID; when none exist generation is
   * blocked with truthful guidance.
   */
  composableTargets: readonly CanonicalRevisionRecord[];
  /**
   * The currently selected Revision (from the Revisions table). When it is a
   * composable target it becomes the default selection; otherwise the menu
   * falls back to the single composable target or requires explicit selection.
   */
  selectedRevisionId?: string | null;
}

export function GenerateOutputMenu({
  projectId,
  composableTargets,
  selectedRevisionId,
  triggerStyle,
  triggerContent,
}: GenerateOutputMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  // The target is derived from the composable set, never from a sequence.
  const selectedTarget = useMemo(() => {
    if (selectedRevisionId) {
      const match = composableTargets.find((r) => r.revisionId === selectedRevisionId);
      if (match) return match;
    }
    // Default to the single composable target when exactly one exists.
    if (composableTargets.length === 1) return composableTargets[0];
    return null;
  }, [composableTargets, selectedRevisionId]);

  const [pickedTargetId, setPickedTargetId] = useState<string | null>(null);
  const effectiveTarget = useMemo(() => {
    if (pickedTargetId) {
      return composableTargets.find((r) => r.revisionId === pickedTargetId) ?? null;
    }
    return selectedTarget;
  }, [composableTargets, pickedTargetId, selectedTarget]);

  const hasTarget = effectiveTarget !== null;

  const focusIndex = (index: number) => {
    const el = itemRefs.current[index];
    if (el) el.focus();
  };

  const choose = (option: GenerateOutputOption) => {
    setOpen(false);
    // Same route pattern either way: the target travels in the query string, so
    // it survives refresh, back/forward, and a copied deep link. Without a
    // target the option is disabled and never navigates.
    if (!effectiveTarget) return;
    navigate(
      `${generatePath(option.route, { projectId })}${
        effectiveTarget ? targetRevisionSearch(effectiveTarget.revisionId) : ''
      }`,
    );
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => focusIndex(0));
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + OPTIONS.length) % OPTIONS.length;
      focusIndex(next);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      className="v4-generate-output"
      ref={rootRef}
      style={triggerStyle ? { height: '100%' } : undefined}
    >
      <button
        ref={triggerRef}
        style={triggerStyle}
        aria-label={triggerContent ? 'Revision generation options' : undefined}
        type="button"
        className="v4-generate-output__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
        data-testid="v4-generate-output-trigger"
      >
        {triggerContent ?? (
          <>
            <FileOutput aria-hidden="true" />
            <span>Generate Output</span>
            <ChevronDown aria-hidden="true" />
          </>
        )}
      </button>
      <V4AnchoredSurface
        open={open}
        id={menuId}
        className="v4-generate-output__menu"
        role="menu"
        ariaLabel="Generate output"
        ownerRef={rootRef}
        triggerRef={triggerRef}
        onRequestClose={() => setOpen(false)}
        testId="v4-generate-output-menu"
      >
        {hasTarget ? (
          <p
            className="v4-generate-output__scope"
            role="presentation"
            data-testid="v4-generate-output-scope"
          >
            Generating into {effectiveTarget!.revisionLabel}
          </p>
        ) : (
          <p
            className="v4-generate-output__scope v4-generate-output__scope--empty"
            role="presentation"
            data-testid="v4-generate-output-empty"
          >
            Create or select a PREPARING Revision before generating outputs.
          </p>
        )}

        {composableTargets.length > 1 ? (
          <label className="v4-generate-output__target-select">
            <span>Target Revision</span>
            <select
              value={effectiveTarget?.revisionId ?? ''}
              onChange={(event) => setPickedTargetId(event.target.value || null)}
              data-testid="v4-generate-output-target-select"
            >
              <option value="">Select a PREPARING Revision…</option>
              {composableTargets.map((revision) => (
                <option key={revision.revisionId} value={revision.revisionId}>
                  {revision.revisionLabel} — PREPARING
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {OPTIONS.map((option, index) => {
          const Icon = option.icon;
          return (
            <button
              key={option.key}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              className="v4-generate-output__item"
              data-testid={option.testId}
              disabled={!hasTarget}
              onClick={() => choose(option)}
              onKeyDown={(event) => onOptionKeyDown(event, index)}
            >
              <span className="v4-generate-output__item-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="v4-generate-output__item-text">
                <strong>{option.label}</strong>
                <span className="v4-generate-output__item-caption">{option.caption}</span>
              </span>
            </button>
          );
        })}
      </V4AnchoredSurface>
    </div>
  );
}
