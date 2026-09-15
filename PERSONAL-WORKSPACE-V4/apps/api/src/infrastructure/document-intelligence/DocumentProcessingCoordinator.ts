import type { DocumentIntelligenceStore } from './DocumentIntelligenceStore.js';
import type { DocumentProcessingWorker } from './DocumentProcessingWorker.js';

export class DocumentProcessingCoordinator {
  private running = false;
  private scheduled = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeDrain: Promise<void> | null = null;
  public constructor(
    private readonly store: DocumentIntelligenceStore,
    private readonly worker: DocumentProcessingWorker,
  ) {}
  public reconcileStartup(): number {
    return this.store.interruptStaleAttempts();
  }
  public notifyQueued(): void {
    if (this.closed || this.scheduled) return;
    this.scheduled = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scheduled = false;
      void this.drain().catch(() => undefined);
    }, 0);
  }
  public async drain(): Promise<void> {
    if (this.closed) return;
    if (this.activeDrain) return this.activeDrain;
    this.activeDrain = this.performDrain().finally(() => {
      this.activeDrain = null;
    });
    return this.activeDrain;
  }
  private async performDrain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.closed) {
        const attemptId = this.store.queuedAttemptIds(1)[0];
        if (!attemptId) break;
        await this.worker.process(attemptId);
      }
    } finally {
      this.running = false;
    }
  }
  public async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.scheduled = false;
    await this.activeDrain;
    await this.worker.close();
  }
}
