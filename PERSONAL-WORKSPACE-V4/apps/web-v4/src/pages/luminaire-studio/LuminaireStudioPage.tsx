import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { FinalProjectHeader } from '../../components/final-ui/ProjectHeader';
import { api } from '../../api/environment';
import { CreateLibraryDraftDialog } from '../project-luminaires/CreateLibraryDraftDialog';
import { StudioRevisionDialog, type StudioRevisionInput } from './StudioRevisionDialog';
import { V4Button } from '../../components/common/V4Button';
import { sctIcons } from '../../components/common/SctIcons';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
} from '../../components/sidebar/sidebarMode';

export const studioRoutes = {
  luminaires: 'luminaires',
  systems: 'lighting-systems',
  accessories: 'system-accessories',
  output: 'output-studio',
  datasheets: 'studio-datasheets',
} as const;
type StudioWindow = Window & {
  studioFlush?: () => Promise<void>;
  studioIsDirty?: () => boolean;
  studioGenerateRevision?: (input: StudioRevisionInput) => Promise<unknown>;
};
const studioIconKeys = {
  bulb: 'luminaires',
  grid: 'systems',
  folder: 'projects',
  sliders: 'settings',
  box: 'accessories',
  file: 'pdf',
  help: 'info',
  plus: 'add',
  save: 'save',
  open: 'open',
  download: 'download',
  edit: 'edit',
  copy: 'duplicate',
  trash: 'delete',
  close: 'close',
  image: 'image',
  check: 'success',
  print: 'print',
  up: 'collapse',
  down: 'expand',
} as const;

export function LuminaireStudioPage() {
  const { projectId } = useParams();
  const { pathname, search } = useLocation();
  const linkedLuminaireId = new URLSearchParams(search).get('luminaireId');
  const targetRevisionId = new URLSearchParams(search).get('targetRevisionId');
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const iconSource = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState(() => readStoredSidebarMode(window.localStorage));
  const [error, setError] = useState('');
  const [generationOpen, setGenerationOpen] = useState(false);
  const [libraryCandidate, setLibraryCandidate] = useState<{
    id: string;
    candidate: Awaited<ReturnType<typeof api.projectLuminaireLibraryDraftCandidate>>;
  } | null>(null);
  const view =
    Object.entries(studioRoutes).find(([, route]) => pathname.endsWith(`/${route}`))?.[0] ??
    'output';
  const sync = () => {
    const computed = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(
      Array.from(computed)
        .filter((key) => key.startsWith('--v4-'))
        .map((key) => [key, computed.getPropertyValue(key)]),
    );
    frame.current?.contentWindow?.postMessage(
      { type: 'studio:theme', theme: document.documentElement.dataset.theme, tokens },
      location.origin,
    );
    frame.current?.contentWindow?.postMessage(
      {
        type: 'studio:icons',
        icons: Object.fromEntries(
          Array.from(iconSource.current?.querySelectorAll('[data-studio-icon]') ?? []).map(
            (node) => [node.getAttribute('data-studio-icon'), node.querySelector('svg')?.innerHTML],
          ),
        ),
      },
      location.origin,
    );
    frame.current?.contentWindow?.postMessage(
      {
        type: 'studio:view',
        view,
        luminaireId: linkedLuminaireId,
        kind: pathname.endsWith('/technical-boq') ? 'boq' : undefined,
      },
      location.origin,
    );
  };
  useEffect(() => {
    sync();
  });
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin) return;
      if (event.data?.type === 'studio:ready') sync();
      if (
        event.data?.type === 'studio:save-library' &&
        typeof event.data.luminaireId === 'string' &&
        projectId
      ) {
        const id = event.data.luminaireId;
        void api
          .projectLuminaireLibraryDraftCandidate(projectId, id)
          .then((candidate) => {
            if (!candidate.eligibility.eligible)
              throw new Error(
                candidate.eligibility.reasonCode ||
                  'This luminaire cannot be promoted to the Library.',
              );
            setLibraryCandidate({ id, candidate });
          })
          .catch((reason: unknown) =>
            setError(
              reason instanceof Error ? reason.message : 'Library review could not be opened.',
            ),
          );
      }
      if (event.data?.type === 'studio:library-tools')
        navigate(`/projects/${projectId}/luminaires/advanced`);
      if (event.data?.type === 'studio:navigate' && event.data.view in studioRoutes)
        navigate(
          `/projects/${projectId}/${studioRoutes[event.data.view as keyof typeof studioRoutes]}`,
        );
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme'],
    });
    window.addEventListener('message', listener);
    return () => {
      observer.disconnect();
      window.removeEventListener('message', listener);
    };
  });
  useEffect(() => {
    let replay = false;
    const saveBeforeLeaving = (event: MouseEvent) => {
      const target =
        event.target instanceof Element ? event.target.closest<HTMLElement>('button,a') : null;
      const studio = frame.current?.contentWindow as StudioWindow | null;
      if (replay || !target || !studio?.studioIsDirty?.()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void studio
        .studioFlush?.()
        .then(() => {
          if (studio.studioIsDirty?.())
            throw new Error('Studio has unsaved edits. Try saving again.');
          replay = true;
          target.click();
          replay = false;
        })
        .catch((reason: unknown) =>
          setError(
            reason instanceof Error ? reason.message : 'Save failed. Your edits remain in Studio.',
          ),
        );
    };
    document.addEventListener('click', saveBeforeLeaving, true);
    return () => document.removeEventListener('click', saveBeforeLeaving, true);
  }, []);
  return (
    <V4AppShell
      finalContacts
      context="project"
      sidebarMode={mode}
      onToggleSidebarMode={() =>
        setMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
    >
      <main
        className="final-ui-reference"
        style={{ flexDirection: 'column', minWidth: 0, minHeight: 0, flex: 1 }}
        data-testid="v4-luminaire-studio"
      >
        <FinalProjectHeader />
        <div ref={iconSource} hidden aria-hidden="true">
          {Object.entries(studioIconKeys).map(([key, name]) => {
            const Glyph = sctIcons[name];
            return (
              <span key={key} data-studio-icon={key}>
                <Glyph size={20} />
              </span>
            );
          })}
        </div>
        {view === 'output' || view === 'datasheets' ? (
          <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'flex-end' }}>
            <V4Button onClick={() => setGenerationOpen(true)}>
              {view === 'datasheets'
                ? 'Generate Revision Specifications'
                : 'Generate Revision Outputs'}
            </V4Button>
          </div>
        ) : null}
        {generationOpen && projectId ? (
          <StudioRevisionDialog
            projectId={projectId}
            specifications={view === 'datasheets'}
            initialRevisionId={targetRevisionId}
            onClose={() => setGenerationOpen(false)}
            generate={async (input) => {
              const studio = frame.current?.contentWindow as StudioWindow | null;
              if (!studio?.studioGenerateRevision)
                throw new Error('Studio is still loading. Please retry once the preview is ready.');
              return studio.studioGenerateRevision(input);
            }}
          />
        ) : null}
        {libraryCandidate && projectId ? (
          <CreateLibraryDraftDialog
            projectId={projectId}
            luminaireId={libraryCandidate.id}
            candidate={libraryCandidate.candidate}
            onClose={() => setLibraryCandidate(null)}
            onCreated={(result) => {
              setLibraryCandidate(null);
              navigate(
                `/luminaire-library?productId=${encodeURIComponent(result.product.productId)}&variantId=${encodeURIComponent(result.variant.variantId)}`,
              );
            }}
          />
        ) : null}
        {error ? <div role="alert">{error}</div> : null}
        <iframe
          ref={frame}
          title="Luminaire Studio 1.4.1"
          data-luminaire-id={linkedLuminaireId ?? undefined}
          onLoad={sync}
          src={`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}studio/index.html?projectId=${encodeURIComponent(projectId ?? '')}${targetRevisionId ? `&targetRevisionId=${encodeURIComponent(targetRevisionId)}` : ''}`}
          style={{ width: '100%', flex: 1, minHeight: 0, border: 0 }}
        />
      </main>
    </V4AppShell>
  );
}
