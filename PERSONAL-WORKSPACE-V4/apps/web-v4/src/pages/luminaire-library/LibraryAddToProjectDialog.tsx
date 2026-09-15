import { LuminaireChoiceField } from '../../components/common/LuminaireChoiceField';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SctLibrary as BookOpen } from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import { V4Button } from '../../components/common/V4Button';
import { V4Field } from '../../components/common/V4Field';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';

export function LibraryAddToProjectDialog({
  versionId,
  productLabel,
  variantLabel,
  description,
  onClose,
  onAdded,
}: {
  versionId: string;
  productLabel: string;
  variantLabel: string;
  description: string;
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const [projectId, setProjectId] = useState('');
  const [tag, setTag] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [unit, setUnit] = useState('No.');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [descriptionOverride, setDescriptionOverride] = useState('');
  const projects = useQuery({
    queryKey: ['v4', 'library', 'add-to-project', 'projects'],
    queryFn: () => api.projects({}),
  });
  const add = useMutation({
    mutationFn: () =>
      api.addProjectLuminaireFromLibrary(projectId, {
        versionId,
        tag,
        category,
        location,
        unit,
        quantity: Number(quantity),
        notes,
        descriptionOverride: descriptionOverride.trim() || null,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => {
      const project = projects.data?.find((item) => item.id === projectId);
      onAdded(
        `${productLabel} · ${variantLabel} added to ${project?.projectCode ?? 'the selected Project'} as an independent managed snapshot.`,
      );
    },
  });
  return (
    <V4FloatingWorkspace
      open
      title="Add Variant to Project"
      description={`${productLabel} · ${variantLabel}. Technical fields and published assets are copied into Project-owned authority.`}
      dismissible={!add.isPending}
      onRequestClose={onClose}
      bodyClassName="v4-library-workspace-body"
      footer={
        <div className="v4-library-workspace-footer">
          <p>No live Library dependency remains after selection.</p>
          <div>
            <V4Button variant="tertiary" onClick={onClose} disabled={add.isPending}>
              Cancel
            </V4Button>
            <V4Button
              variant="primary"
              leadingIcon={<BookOpen />}
              disabled={!projectId || !tag.trim() || add.isPending}
              onClick={() => add.mutate()}
            >
              Add to Project
            </V4Button>
          </div>
        </div>
      }
    >
      <div className="v4-library-editor v4-library-editor--project-selection">
        <V4Field label="Project" controlId="library-target-project" required>
          <select
            id="library-target-project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Select Project…</option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.projectCode} · {project.projectName}
              </option>
            ))}
          </select>
        </V4Field>
        <V4Field label="Tag" controlId="library-project-tag" required>
          <input
            id="library-project-tag"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
          />
        </V4Field>
        <LuminaireChoiceField
          label="Project Category"
          kind="category"
          value={category}
          onChange={setCategory}
        />
        <V4Field label="Location" controlId="library-project-location">
          <input
            id="library-project-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </V4Field>
        <V4Field label="Unit" controlId="library-project-unit">
          <input
            id="library-project-unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          />
        </V4Field>
        <V4Field label="Quantity" controlId="library-project-quantity">
          <input
            id="library-project-quantity"
            type="number"
            min="0"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </V4Field>
        <V4Field label="Project Notes" controlId="library-project-notes">
          <textarea
            id="library-project-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </V4Field>
        <V4Field
          label="Project Description Override"
          controlId="library-project-description"
          helpText="The only Project-owned technical override."
        >
          <textarea
            id="library-project-description"
            value={descriptionOverride}
            placeholder={description}
            onChange={(event) => setDescriptionOverride(event.target.value)}
          />
        </V4Field>
      </div>
      {projects.isLoading ? <p role="status">Loading Projects…</p> : null}
      {projects.error ? <p role="alert">Projects could not be loaded.</p> : null}
      {add.error ? (
        <p role="alert">
          {add.error instanceof Error ? add.error.message : 'The Variant could not be added.'}
        </p>
      ) : null}
    </V4FloatingWorkspace>
  );
}
