import { useMutation, useQuery } from '@tanstack/react-query';
import type { ProjectLuminaireLibraryStatus } from '@scli/api-client';
import { SctNext as ArrowRight } from '../../components/common/SctIcons';
import { GitCompareArrows } from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import { V4Button } from '../../components/common/V4Button';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { displayLuminaireTechnicalValue } from '../../components/common/luminaireTechnicalDisplay';

export function LibraryUpdateDialog({
  projectId,
  luminaireId,
  status,
  onClose,
  onUpdated,
}: {
  projectId: string;
  luminaireId: string;
  status: ProjectLuminaireLibraryStatus;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const comparison = useQuery({
    queryKey: ['v4', 'library', 'compare', projectId, luminaireId, status.latestVersionId],
    queryFn: () =>
      api.compareProjectLuminaireLibrary(projectId, luminaireId, status.latestVersionId),
  });
  const update = useMutation({
    mutationFn: () =>
      api.updateProjectLuminaireFromLibrary(projectId, luminaireId, {
        expectedSelectedVersionId: status.selectedVersionId,
        targetVersionId: status.latestVersionId,
        expectedBindingRowVersion: status.binding.rowVersion,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: onUpdated,
  });
  return (
    <V4FloatingWorkspace
      open
      title="Compare Library Changes"
      description={`Current Project Version: ${status.selectedVersionId.slice(0, 8)} · Latest Library Version: v${status.latestVersionSequence}`}
      dismissible={!update.isPending}
      onRequestClose={onClose}
      bodyClassName="v4-p5a-workspace-body"
      footer={
        <div className="v4-p5a-workspace-footer">
          <p>Project-owned fields and Description Override will be preserved.</p>
          <div>
            <V4Button variant="tertiary" onClick={onClose} disabled={update.isPending}>
              Keep Current
            </V4Button>
            <V4Button
              variant="primary"
              leadingIcon={<GitCompareArrows />}
              disabled={
                status.status !== 'UPDATE_AVAILABLE' ||
                !comparison.data ||
                comparison.isFetching ||
                comparison.isError ||
                update.isPending
              }
              onClick={() => update.mutate()}
            >
              Update Project
            </V4Button>
          </div>
        </div>
      }
    >
      <div className="v4-library-compare">
        <header>
          <GitCompareArrows aria-hidden="true" />
          <div>
            <h3>Deterministic field and asset changes</h3>
            <p>
              Project-owned Tag, Category, Location, Unit, Quantity, Notes and Description Override
              are preserved. No Revision will be created.
            </p>
          </div>
        </header>
        {comparison.isLoading ? <p role="status">Comparing exact immutable snapshots…</p> : null}
        {comparison.isError ? (
          <p role="alert">
            {comparison.error instanceof Error
              ? comparison.error.message
              : 'Changes could not be compared.'}
          </p>
        ) : null}
        {comparison.data ? (
          <>
            <section>
              <h4>Technical fields</h4>
              {comparison.data.fieldChanges.length ? (
                <dl>
                  {comparison.data.fieldChanges.map((change) => (
                    <div key={change.field}>
                      <dt>{change.field}</dt>
                      <dd>
                        <span>{displayLuminaireTechnicalValue(change.field, change.before)}</span>
                        <ArrowRight aria-hidden="true" />
                        <strong>
                          {displayLuminaireTechnicalValue(change.field, change.after)}
                        </strong>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>No technical field changes.</p>
              )}
            </section>
            <section>
              <h4>Assets</h4>
              {comparison.data.assetChanges.length ? (
                <dl>
                  {comparison.data.assetChanges.map((change) => (
                    <div key={change.assetType}>
                      <dt>{change.assetType}</dt>
                      <dd>
                        <span>
                          {change.beforeAssetVersionIds.map((id) => id.slice(0, 8)).join(', ') ||
                            'None'}
                        </span>
                        <ArrowRight aria-hidden="true" />
                        <strong>
                          {change.afterAssetVersionIds.map((id) => id.slice(0, 8)).join(', ') ||
                            'None'}
                        </strong>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>No asset membership changes.</p>
              )}
            </section>
          </>
        ) : null}
        {update.error ? (
          <p role="alert">
            {update.error instanceof Error ? update.error.message : 'Project update failed.'}
          </p>
        ) : null}
      </div>
    </V4FloatingWorkspace>
  );
}
