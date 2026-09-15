import type { DocumentIntelligenceStore } from './DocumentIntelligenceStore.js';
import type { DocumentSourceAdmission } from './DocumentSourceAdmission.js';
import { PdfExtractionAdapter } from './PdfExtractionAdapter.js';
import { LocalOcrAdapter } from './LocalOcrAdapter.js';

export class DocumentEvidencePreviewService {
  public constructor(
    private readonly store: DocumentIntelligenceStore,
    private readonly admission: DocumentSourceAdmission,
    private readonly pdf = new PdfExtractionAdapter(),
    private readonly artifactSourceResolver?: (artifactVersionId: string) => Promise<string>,
    private readonly luminaireAssetSourceResolver?: (
      luminaireAssetVersionId: string,
    ) => Promise<string>,
  ) {}

  public async page(documentId: string, pageNumber: number) {
    const document = this.store.getDocument(documentId);
    const attempt = this.store.activeAttempt(documentId);
    const source = this.store.sourceForAttempt(attempt.id);
    const sourcePath = source.managedLocator
      ? this.admission.resolveManagedLocator(source.managedLocator)
      : source.artifactVersionId && this.artifactSourceResolver
        ? await this.artifactSourceResolver(source.artifactVersionId)
        : source.luminaireAssetVersionId && this.luminaireAssetSourceResolver
          ? await this.luminaireAssetSourceResolver(source.luminaireAssetVersionId)
          : null;
    if (!sourcePath) throw new Error('Artifact-backed preview is unavailable.');
    const rendered = await this.pdf.renderPage(sourcePath, pageNumber);
    const first = this.store.evidence(document.activeVersionId, 0, 100);
    const values = [...first.items];
    for (let page = 1; page * 100 < Math.min(first.totalCount, 5000); page++)
      values.push(...this.store.evidence(document.activeVersionId, page, 100).items);
    const evidence = values
      .filter((item) => item.pageNumber === pageNumber)
      .slice(0, 100)
      .map((item) => ({
        id: item.id,
        canonicalField: item.canonicalField,
        snippet: item.rawValue.slice(0, 500),
        method: item.method,
        confidence: item.confidence,
        region: item.region,
      }));
    // Geometry recovery is display-only: never replace extracted values or confidence.
    if (evidence.some((item) => !item.region)) {
      const ocr = new LocalOcrAdapter();
      try {
        const located = await ocr.recognize(rendered.png, {
          x: 0,
          y: 0,
          width: rendered.width,
          height: rendered.height,
        });
        const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const item of evidence) {
          if (item.region) continue;
          const snippet = normalize(item.snippet);
          const matches = located.regions.filter(
            (line) => normalize(line.text) === snippet && line.confidence >= 80,
          );
          if (matches.length === 1) item.region = matches[0]!.region;
        }
      } catch {
        /* The full PDF page remains available when precise location is uncertain. */
      } finally {
        await ocr.terminate().catch(() => undefined);
      }
    }
    return {
      pageNumber: rendered.pageNumber,
      width: rendered.width,
      height: rendered.height,
      mediaType: 'image/png' as const,
      pngBase64: rendered.png.toString('base64'),
      evidence,
    };
  }
}
