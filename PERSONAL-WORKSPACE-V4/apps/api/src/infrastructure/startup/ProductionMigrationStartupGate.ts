/**
 * ProductionMigrationStartupGate: production adapter for the MigrationStartupGatePort (P1.8I).
 *
 * Read-only interrupted-migration startup gate. It uses only the existing journal public
 * inspection APIs (listNonTerminalAttempts and inspectAttemptResolution) and maps existing
 * safe startup evidence into the coordinator contract.
 *
 * The gate never:
 *
 * - calls InterruptedMigrationReconciler.apply()
 * - appends a resolution
 * - creates a resolution sidecar
 * - alters a journal
 * - approves a newly generated plan automatically
 * - mutates the database
 *
 * Startup proceeds only when existing evidence proves that no unresolved attempt exists, or
 * that every non-terminal attempt has an effective resolution which explicitly allows startup
 * and requires no manual action. Unresolved, corrupt, stale, ambiguous, manually actionable,
 * or unapplied-plan states fail closed to RECOVERY_REQUIRED.
 */

import { PersistentMigrationJournalError } from '../migration/journal/journal-types';
import type { AttemptResolutionInspection } from '../migration/journal/journal-types';
import type {
  MigrationJournalInspectionPort,
  MigrationStartupGatePort,
  MigrationStartupGateResult,
} from './startup-types';

/**
 * Read-only production interrupted-attempt gate. The real PersistentMigrationJournal satisfies
 * the inspection port structurally; reconciliation is never applied and no sidecar is ever
 * written.
 */
export class ProductionMigrationStartupGate implements MigrationStartupGatePort {
  private readonly journal: MigrationJournalInspectionPort;

  public constructor(journal: MigrationJournalInspectionPort) {
    this.journal = journal;
  }

  public async inspect(): Promise<MigrationStartupGateResult> {
    const attempts = await this.journal.listNonTerminalAttempts();
    if (attempts.length === 0) {
      return { status: 'ALLOWED' };
    }
    for (const attempt of attempts) {
      let resolution: AttemptResolutionInspection;
      try {
        resolution = await this.journal.inspectAttemptResolution(attempt.attemptId);
      } catch (error) {
        if (error instanceof PersistentMigrationJournalError) {
          // A journal that cannot be inspected cannot prove startup is safe.
          return { status: 'RECOVERY_REQUIRED', reasonCode: 'RECOVERY_REQUIRED' };
        }
        throw error;
      }
      if (
        resolution.effectiveResolutionStatus === 'EFFECTIVE' &&
        resolution.startupAllowed === true &&
        resolution.manualActionRequired === false
      ) {
        continue;
      }
      return { status: 'RECOVERY_REQUIRED', reasonCode: 'UNRESOLVED_MIGRATION_ATTEMPT' };
    }
    return { status: 'ALLOWED' };
  }
}
