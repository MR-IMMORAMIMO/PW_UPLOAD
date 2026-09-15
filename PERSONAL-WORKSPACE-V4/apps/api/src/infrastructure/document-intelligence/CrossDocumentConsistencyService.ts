import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { compatibleTechnicalBasis, DOCUMENT_INTELLIGENCE_LIMITS, DomainError } from '@scli/domain';
import type { DocumentIntelligenceStore } from './DocumentIntelligenceStore.js';
import type { DocumentConsistencyResultRead } from '@scli/contracts';

type Row = Record<string, unknown>;
const codes = {
  QUANTITY: 'LUMINAIRE_QUANTITY_CONFLICT',
  ORDERING_CODE: 'ORDERING_CODE_CONFLICT',
  MANUFACTURER: 'MANUFACTURER_CONFLICT',
  WATTAGE: 'WATTAGE_CONFLICT',
  CCT: 'CCT_CONFLICT',
  BEAM: 'BEAM_CONFLICT',
} as const;

export class CrossDocumentConsistencyService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly store: DocumentIntelligenceStore,
  ) {}
  public recompute(projectId: string): DocumentConsistencyResultRead {
    const documentCount = this.database
      .prepare(
        `SELECT COUNT(*) count FROM intelligence_documents WHERE confirmed_project_id=? AND lifecycle='ACCEPTED' AND comparison_enabled=1`,
      )
      .get(projectId) as Row;
    const eligibleDocuments = Number(documentCount.count);
    if (eligibleDocuments === 0)
      throw new DomainError(
        'CONFLICT',
        'No eligible accepted documents are enabled for comparison.',
        409,
        { reasonCode: 'DOCUMENT_CONSISTENCY_NO_ELIGIBLE_DOCUMENTS' },
      );
    if (eligibleDocuments === 1)
      throw new DomainError(
        'CONFLICT',
        'At least two compatible documents are required for this comparison.',
        409,
        { reasonCode: 'DOCUMENT_CONSISTENCY_INSUFFICIENT_DOCUMENTS' },
      );
    if (eligibleDocuments > DOCUMENT_INTELLIGENCE_LIMITS.comparisonDocuments)
      throw new DomainError(
        'CONFLICT',
        'Project consistency scope exceeds the bounded document limit.',
        409,
      );
    const rows = this.database
      .prepare(
        `SELECT d.document_id,d.active_version_id,v.canonical_field,v.normalized_value_json,v.unit,v.basis,
      (SELECT normalized_value_json FROM document_extraction_values tag WHERE tag.version_id=v.version_id AND tag.canonical_field='TAG' ORDER BY tag.page_number LIMIT 1) tag
      FROM intelligence_documents d JOIN document_extraction_values v ON v.version_id=d.active_version_id
      WHERE d.confirmed_project_id=? AND d.lifecycle='ACCEPTED' AND d.comparison_enabled=1 AND v.canonical_field IN ('QUANTITY','ORDERING_CODE','MANUFACTURER','WATTAGE','CCT','BEAM')
      ORDER BY d.document_id,v.canonical_field LIMIT ?`,
      )
      .all(projectId, DOCUMENT_INTELLIGENCE_LIMITS.comparisonValues + 1) as Row[];
    if (rows.length > DOCUMENT_INTELLIGENCE_LIMITS.comparisonValues)
      throw new DomainError(
        'CONFLICT',
        'Project consistency scope exceeds the bounded evidence limit.',
        409,
      );
    const fingerprint = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    let findings = 0;
    const affectedDocumentIds = new Set<string>();
    this.database
      .prepare(
        `UPDATE document_quality_findings SET state='SUPERSEDED',row_version=row_version+1,updated_at=? WHERE document_id IN (SELECT document_id FROM intelligence_documents WHERE confirmed_project_id=?) AND finding_code IN ('LUMINAIRE_QUANTITY_CONFLICT','ORDERING_CODE_CONFLICT','MANUFACTURER_CONFLICT','WATTAGE_CONFLICT','CCT_CONFLICT','BEAM_CONFLICT','VALUE_BASIS_CONFLICT') AND generation_fingerprint<>? AND state<>'SUPERSEDED'`,
      )
      .run(new Date().toISOString(), projectId, fingerprint);
    const grouped = new Map<string, Row[]>();
    for (const row of rows) {
      if (row.tag === null || row.tag === undefined) continue;
      const key = `${String(row.tag)}:${String(row.canonical_field)}`;
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    for (const group of grouped.values()) {
      if (group.length < 2) continue;
      const base = group[0]!;
      const compatible = group.filter((row) =>
        compatibleTechnicalBasis(
          base.unit === null ? null : String(base.unit),
          base.basis === null ? null : String(base.basis),
          row.unit === null ? null : String(row.unit),
          row.basis === null ? null : String(row.basis),
        ),
      );
      const field = String(base.canonical_field) as keyof typeof codes;
      const target = String(base.document_id);
      if (compatible.length !== group.length) {
        this.store.addFinding(
          target,
          String(base.active_version_id),
          'VALUE_BASIS_CONFLICT',
          'WARNING',
          'Value basis conflict',
          'Accepted documents contain values for the same Tag and field with incompatible units or bases.',
          'Review the source units and quantity basis; incompatible values are not compared.',
          group,
          fingerprint,
          field,
          true,
        );
        findings += 1;
        affectedDocumentIds.add(target);
      }
      const distinct = new Set(compatible.map((row) => String(row.normalized_value_json)));
      if (distinct.size < 2) continue;
      this.store.addFinding(
        target,
        String(base.active_version_id),
        codes[field],
        'WARNING',
        `${field.replaceAll('_', ' ')} conflict`,
        `Accepted documents for the same confirmed Project contain different ${field.toLocaleLowerCase('en')} evidence.`,
        'Review every source value; Phase 5C does not choose a winner.',
        compatible,
        fingerprint,
        field,
        true,
      );
      findings += 1;
      affectedDocumentIds.add(target);
    }
    return {
      fingerprint,
      findings,
      eligibleDocuments,
      affectedDocumentIds: [...affectedDocumentIds],
    };
  }
}
