import { useMutation, useQuery } from '@tanstack/react-query';
import { Cable, Play, RefreshCw, TriangleAlert } from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import { V4StatusPill } from '../../components/common/V4StatusPill';
import {
  changeIntegration,
  executeHandoff,
  integrationStatuses,
  type IntegrationHealth,
  type IntegrationStatusModel,
} from '../../desktop/integrations';

const LABELS: Record<IntegrationHealth, string> = {
  CONFIGURED: 'Configured',
  DISCOVERED_SELECTION_REQUIRED: 'Discovered — selection required',
  SELECTED_VERSION_MISSING: 'Selected version missing',
  NOT_FOUND: 'Not Found',
  DESKTOP_UNAVAILABLE: 'Desktop unavailable',
};

function statusVariant(health: IntegrationHealth) {
  if (health === 'CONFIGURED') return 'success' as const;
  if (health === 'DISCOVERED_SELECTION_REQUIRED') return 'info' as const;
  if (health === 'SELECTED_VERSION_MISSING') return 'warning' as const;
  return 'danger' as const;
}

export function IntegrationSettingsSection() {
  const status = useQuery({ queryKey: ['v4', 'integration-status'], queryFn: integrationStatuses });
  const change = useMutation({
    mutationFn: changeIntegration,
    onSuccess: () => status.refetch(),
  });
  const testLaunch = useMutation({
    mutationFn: async (application: 'AUTOCAD' | 'DIALUX') => {
      const handoff = await api.testIntegrationLaunchHandoff(application);
      if (!(await executeHandoff(handoff))) throw new Error('Desktop launch request failed.');
      return application;
    },
  });

  return (
    <section className="v4-settings-integrations" aria-label="Integrations and automation settings">
      <header>
        <span className="v4-settings-card__icon is-teal">
          <Cable aria-hidden="true" />
        </span>
        <div>
          <h2>Integrations &amp; Automation</h2>
          <p>Choose exact desktop installations used by contextual Tool Sessions.</p>
        </div>
        <button type="button" onClick={() => void status.refetch()} disabled={status.isFetching}>
          <RefreshCw aria-hidden="true" /> Retry Detection
        </button>
      </header>
      <div className="v4-settings-integrations__grid">
        {(status.data ?? []).map((integration) => (
          <IntegrationCard
            key={integration.application}
            value={integration}
            changing={change.isPending}
            launching={testLaunch.isPending}
            onChange={() => change.mutate(integration.application)}
            onTest={() => testLaunch.mutate(integration.application)}
          />
        ))}
      </div>
      {testLaunch.isSuccess ? <p role="status">Launch requested.</p> : null}
      {testLaunch.isError ? (
        <p className="v4-settings-integrations__error" role="alert">
          <TriangleAlert aria-hidden="true" /> Test Launch could not be requested.
        </p>
      ) : null}
    </section>
  );
}

function IntegrationCard({
  value,
  changing,
  launching,
  onChange,
  onTest,
}: {
  value: IntegrationStatusModel;
  changing: boolean;
  launching: boolean;
  onChange: () => void;
  onTest: () => void;
}) {
  const label = value.application === 'AUTOCAD' ? 'AutoCAD' : 'DIALux';
  return (
    <article className="v4-settings-integration-card">
      <div className="v4-settings-integration-card__title">
        <h3>{label}</h3>
        <V4StatusPill variant={statusVariant(value.health)}>{LABELS[value.health]}</V4StatusPill>
      </div>
      {value.selectedPath ? (
        <p className="v4-settings-integration-card__path" title={value.selectedPath}>
          Selected: {value.selectedPath}
        </p>
      ) : (
        <p>No installation selected.</p>
      )}
      {value.discoveries.length ? (
        <ul aria-label={`${label} discovered installations`}>
          {value.discoveries.map((discovery) => (
            <li key={discovery.executablePath}>
              <strong>{discovery.version ? `${label} ${discovery.version}` : label}</strong>
              <span title={discovery.executablePath}>{discovery.executablePath}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No discovered installations.</p>
      )}
      <div className="v4-settings-integration-card__actions">
        <button
          type="button"
          onClick={onChange}
          disabled={changing || value.health === 'DESKTOP_UNAVAILABLE'}
        >
          Change
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={launching || value.health !== 'CONFIGURED'}
        >
          <Play aria-hidden="true" /> Test Launch
        </button>
      </div>
    </article>
  );
}
