/**
 * Focused tests for the production migration startup gate (P1.8I).
 *
 * The gate is read-only: it inspects interrupted attempts and existing effective resolutions
 * through the journal public APIs and never applies reconciliation, never appends a resolution,
 * never creates a resolution sidecar, never alters a journal, and never mutates the database.
 * Unsafe states must fail closed to RECOVERY_REQUIRED.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PersistentMigrationJournal } from '../migration/journal/PersistentMigrationJournal';
import { PersistentMigrationJournalError } from '../migration/journal/journal-types';
import type {
  AttemptResolutionInspection,
  AttemptSummary,
} from '../migration/journal/journal-types';
import { PathResolverService } from '../path/PathResolverService';
import { ProductionMigrationStartupGate } from './ProductionMigrationStartupGate';
import type { MigrationJournalInspectionPort } from './startup-types';

const FIXED_DATE = new Date('2026-08-04T12:00:00.000Z');

function removeTree(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else unlinkSync(child);
  }
  rmdirSync(dir);
}

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) removeTree(root);
  }
});

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-migration-gate-'));
  tempRoots.push(dir);
  return dir;
}

function attemptSummary(attemptId: string): AttemptSummary {
  return {
    classification: 'non-terminal',
    attemptId,
    identityHash: 'identity-hash',
    latestState: 'CREATED',
    terminal: false,
    corrupt: false,
  };
}

function resolution(
  overrides: Partial<AttemptResolutionInspection> = {},
): AttemptResolutionInspection {
  return {
    attemptId: 'att-0001',
    classification: 'non-terminal',
    effectiveResolutionStatus: 'EFFECTIVE',
    newAttemptAllowed: false,
    startupAllowed: true,
    manualActionRequired: false,
    ...overrides,
  };
}

class RecordingJournal implements MigrationJournalInspectionPort {
  public readonly calls: string[] = [];
  public attempts: AttemptSummary[] = [];
  public resolutions = new Map<string, AttemptResolutionInspection>();
  public inspectError: Error | null = null;
  public listError: Error | null = null;

  public async listNonTerminalAttempts(): Promise<AttemptSummary[]> {
    this.calls.push('listNonTerminalAttempts');
    if (this.listError !== null) throw this.listError;
    return [...this.attempts];
  }

  public async inspectAttemptResolution(attemptId: string): Promise<AttemptResolutionInspection> {
    this.calls.push('inspectAttemptResolution:' + attemptId);
    if (this.inspectError !== null) throw this.inspectError;
    const result = this.resolutions.get(attemptId);
    if (!result) throw new Error('missing resolution for ' + attemptId);
    return result;
  }
}

describe('ProductionMigrationStartupGate', () => {
  it('allows startup when no non-terminal attempts exist', async () => {
    const journal = new RecordingJournal();
    const gate = new ProductionMigrationStartupGate(journal);
    await expect(gate.inspect()).resolves.toEqual({ status: 'ALLOWED' });
    expect(journal.calls).toEqual(['listNonTerminalAttempts']);
  });

  it('requires recovery for an unresolved non-terminal attempt', async () => {
    const journal = new RecordingJournal();
    journal.attempts = [attemptSummary('att-0001')];
    journal.resolutions.set('att-0001', resolution({ effectiveResolutionStatus: 'ABSENT' }));
    const gate = new ProductionMigrationStartupGate(journal);
    await expect(gate.inspect()).resolves.toEqual({
      status: 'RECOVERY_REQUIRED',
      reasonCode: 'UNRESOLVED_MIGRATION_ATTEMPT',
    });
  });

  it('requires recovery when an effective resolution disallows startup', async () => {
    const journal = new RecordingJournal();
    journal.attempts = [attemptSummary('att-0001')];
    journal.resolutions.set(
      'att-0001',
      resolution({ effectiveResolutionStatus: 'EFFECTIVE', startupAllowed: false }),
    );
    const gate = new ProductionMigrationStartupGate(journal);
    await expect(gate.inspect()).resolves.toEqual({
      status: 'RECOVERY_REQUIRED',
      reasonCode: 'UNRESOLVED_MIGRATION_ATTEMPT',
    });
  });

  it('requires recovery when an effective resolution demands manual action', async () => {
    const journal = new RecordingJournal();
    journal.attempts = [attemptSummary('att-0001')];
    journal.resolutions.set(
      'att-0001',
      resolution({ effectiveResolutionStatus: 'EFFECTIVE', manualActionRequired: true }),
    );
    const gate = new ProductionMigrationStartupGate(journal);
    await expect(gate.inspect()).resolves.toEqual({
      status: 'RECOVERY_REQUIRED',
      reasonCode: 'UNRESOLVED_MIGRATION_ATTEMPT',
    });
  });

  it('requires recovery for stale and corrupt resolutions', async () => {
    for (const status of ['STALE', 'CORRUPT'] as const) {
      const journal = new RecordingJournal();
      journal.attempts = [attemptSummary('att-0001')];
      journal.resolutions.set('att-0001', resolution({ effectiveResolutionStatus: status }));
      const gate = new ProductionMigrationStartupGate(journal);
      await expect(gate.inspect()).resolves.toEqual({
        status: 'RECOVERY_REQUIRED',
        reasonCode: 'UNRESOLVED_MIGRATION_ATTEMPT',
      });
    }
  });

  it('allows startup when every non-terminal attempt has a startup-allowing resolution', async () => {
    const journal = new RecordingJournal();
    journal.attempts = [attemptSummary('att-0001'), attemptSummary('att-0002')];
    journal.resolutions.set('att-0001', resolution({ attemptId: 'att-0001' }));
    journal.resolutions.set('att-0002', resolution({ attemptId: 'att-0002' }));
    const gate = new ProductionMigrationStartupGate(journal);
    await expect(gate.inspect()).resolves.toEqual({ status: 'ALLOWED' });
  });

  it('maps journal inspection failures to RECOVERY_REQUIRED', async () => {
    const journal = new RecordingJournal();
    journal.attempts = [attemptSummary('att-0001')];
    journal.inspectError = new PersistentMigrationJournalError(
      'RESOLUTION_CORRUPT',
      'resolution cannot be inspected',
    );
    const gate = new ProductionMigrationStartupGate(journal);
    await expect(gate.inspect()).resolves.toEqual({
      status: 'RECOVERY_REQUIRED',
      reasonCode: 'RECOVERY_REQUIRED',
    });
  });

  it('lets unknown errors propagate', async () => {
    const journal = new RecordingJournal();
    journal.attempts = [attemptSummary('att-0001')];
    journal.inspectError = new Error('programming boom');
    const gate = new ProductionMigrationStartupGate(journal);
    await expect(gate.inspect()).rejects.toThrow('programming boom');
  });

  it('only reads journal state and never calls reconciliation or resolution writers', async () => {
    const journal = new RecordingJournal();
    journal.attempts = [attemptSummary('att-0001')];
    journal.resolutions.set('att-0001', resolution());
    const gate = new ProductionMigrationStartupGate(journal);
    await gate.inspect();
    expect(journal.calls).toEqual(['listNonTerminalAttempts', 'inspectAttemptResolution:att-0001']);
  });

  it('fails closed on a real unresolved journal attempt without writing anything', async () => {
    const tempRoot = newTempDir();
    const dataRoot = path.join(tempRoot, 'data');
    const journalRoot = path.join(dataRoot, 'journal');
    mkdirSync(journalRoot, { recursive: true });
    const databasePath = path.join(dataRoot, 'scli.sqlite');
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const journal = new PersistentMigrationJournal({
      journalRoot,
      databasePath,
      pathResolver: new PathResolverService(dataRoot),
      clock: { now: () => FIXED_DATE },
      idGenerator: { generate: () => 'att-0001' },
      appVersion: '3.3.0',
      journalFormatVersion: 1 as const,
    });
    await journal.createAttempt({ fromVersion: 0, targetVersion: 1 });

    const gate = new ProductionMigrationStartupGate(journal);
    await expect(gate.inspect()).resolves.toEqual({
      status: 'RECOVERY_REQUIRED',
      reasonCode: 'UNRESOLVED_MIGRATION_ATTEMPT',
    });

    const entries = readdirSync(journalRoot);
    expect(entries.filter((entry) => entry.includes('resolution'))).toEqual([]);
    expect(entries.filter((entry) => !entry.endsWith('.jsonl'))).toEqual([]);
  });
});
