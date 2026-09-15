import type { StudioPreparedAsset } from './StudioAssetBridge.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  luminaireRecordSchema,
  studioDocumentSchema,
  type SaveStudioDocument,
  type StudioDocument,
} from '@scli/contracts';
import { DomainError, type AppUser, type LuminaireRecord, type Project } from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import { StudioDocumentStore } from './StudioDocumentStore.js';

const fields = {
  tag: 'tag',
  description: 'description',
  manufacturer: 'manufacturer',
  model: 'model',
  orderCode: 'orderingCode',
  power: 'wattage',
  lumens: 'lumens',
  cct: 'lightColor',
  cri: 'cri',
  beam: 'beamAngle',
  ip: 'ipRating',
  mounting: 'mounting',
  dimensions: 'dimensions',
  cutout: 'cutout',
  finish: 'bodyColorFinish',
  driver: 'driver',
  control: 'control',
  unit: 'unit',
  quantity: 'quantity',
  area: 'location',
  notes: 'notes',
  type: 'category',
} as const;
const numberFields = new Set(['power', 'lumens', 'cct', 'cri']);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class StudioWorkspaceService {
  private readonly defaults: StudioDocument;
  public constructor(
    private readonly personal: PersonalWorkspaceStore,
    private readonly documents: StudioDocumentStore,
    sourceRoot: string,
  ) {
    // The reviewed, owner-supplied pure domain module has no filesystem or network access.
    const sandbox = { crypto: { randomUUID }, module: { exports: {} } };
    runInNewContext(readFileSync(path.join(sourceRoot, 'core.js'), 'utf8'), sandbox, {
      timeout: 2000,
    });
    const core = sandbox.module.exports as { newProject: () => unknown };
    this.defaults = studioDocumentSchema.parse(core.newProject());
  }

  private fingerprint(project: Project): string {
    return hash({ project, luminaires: this.personal.getWorkspace(project.id).luminaires });
  }

  private row(
    record: LuminaireRecord,
    previous?: StudioDocument['luminaires'][number],
  ): StudioDocument['luminaires'][number] {
    const result = {
      ...previous,
      id: record.id,
      tag: record.tag,
    } as StudioDocument['luminaires'][number];
    for (const [studioKey, canonicalKey] of Object.entries(fields)) {
      const value = record[canonicalKey];
      // Preserve unknown/textual technical values. Only unambiguous numeric units are normalized for Studio.
      const numeric =
        numberFields.has(studioKey) && typeof value === 'string'
          ? value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:W(?:\/m)?|lm(?:\/m)?|K)?$/i)
          : null;
      result[studioKey] = numeric ? Number(numeric[1]) : (value ?? '');
    }
    return result;
  }

  public read(project: Project) {
    const stored = this.documents.read(project.id);
    const document = structuredClone(stored?.document ?? this.defaults);
    document.id = project.id;
    const settings = this.personal.getSettings();
    document.meta = {
      ...document.meta,
      company: settings.companyName,
      prepared: settings.designerName,
      name: project.projectName,
      number: project.projectCode,
      client: project.clientName,
    };
    const canonical = this.personal.getWorkspace(project.id).luminaires;
    const ordered = new Map(document.luminaires.map((item, index) => [item.id, index]));
    document.luminaires = canonical
      .map((item) =>
        this.row(
          item,
          document.luminaires.find((row) => row.id === item.id),
        ),
      )
      .sort(
        (a, b) =>
          (ordered.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (ordered.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
    return {
      document: studioDocumentSchema.parse(document),
      version: stored?.version ?? 0,
      fingerprint: this.fingerprint(project),
    };
  }

  public save(
    project: Project,
    input: SaveStudioDocument,
    actor: AppUser,
    assets: StudioPreparedAsset[] = [],
  ) {
    const requestHash = hash(input);
    const completed = this.documents.operation(project.id, input.operationId);
    if (completed) {
      if (completed.requestHash !== requestHash)
        throw new DomainError(
          'CONFLICT',
          'This save operation already contains different data.',
          409,
        );
      return this.read(project);
    }
    return this.personal.runInTransaction(() => {
      if (input.baseFingerprint !== this.fingerprint(project))
        throw new DomainError(
          'CONFLICT',
          'Project data changed. Reload Studio before saving; your current edits have been kept.',
          409,
        );
      if (input.document.id !== project.id)
        throw new DomainError('CONFLICT', 'Studio must use the current project identity.', 409);
      const current = this.personal.getWorkspace(project.id).luminaires;
      const document = structuredClone(input.document);
      const deleted = new Set(input.deletedLuminaireIds ?? []);
      for (const previous of current) {
        if (!document.luminaires.some((row) => row.id === previous.id)) {
          if (!deleted.has(previous.id))
            throw new DomainError(
              'CONFLICT',
              'Removing a luminaire requires an explicit delete.',
              409,
            );
          this.personal.deleteLuminaire(project.id, previous.id);
        }
      }
      for (const row of document.luminaires) {
        const clientId = row.id;
        const previous = current.find((item) => item.id === row.id);
        const baseline = previous ? this.row(previous) : null;
        const values: Record<string, unknown> = previous
          ? { ...previous }
          : { tag: row.tag, unit: 'pcs', quantity: 0 };
        for (const [studioKey, canonicalKey] of Object.entries(fields)) {
          if (previous && row[studioKey] === baseline?.[studioKey]) continue;
          if (row[studioKey] === undefined) continue;
          values[canonicalKey] =
            canonicalKey === 'quantity' ? row[studioKey] : String(row[studioKey] ?? '');
        }
        // Images, attached PDFs and Studio-only fields remain in the immutable Studio document.
        // Existing managed asset paths and library-owned technical fields retain their canonical policies.
        if (previous && row.image === '' && previous.imagePath) values.imagePath = '';
        const canonicalInput = luminaireRecordSchema.parse(values);
        if (previous) {
          const oldInput = luminaireRecordSchema.parse(previous);
          if (JSON.stringify(oldInput) !== JSON.stringify(canonicalInput))
            this.personal.updateLuminaire(project.id, previous.id, canonicalInput, actor);
        } else {
          row.id = this.personal.addLuminaire(project.id, canonicalInput, actor).id;
        }
        for (const asset of assets.filter((item) => item.clientId === clientId)) {
          this.personal.attachLuminaireAsset(
            project.id,
            row.id,
            { assetType: asset.type, filePath: asset.managed.absolutePath },
            actor,
            asset.managed,
          );
        }
      }
      document.meta = {
        ...document.meta,
        name: project.projectName,
        number: project.projectCode,
        client: project.clientName,
      };
      this.documents.save(
        project.id,
        { ...input, document },
        actor,
        new Date().toISOString(),
        requestHash,
      );
      return this.read(project);
    });
  }
}
