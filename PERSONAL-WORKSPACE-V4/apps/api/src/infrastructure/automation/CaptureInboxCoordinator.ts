import { watch, type FSWatcher } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { toolContextCanAuthorizeNewCapture, type ToolContext } from '@scli/domain';
import { ToolContextService } from '../managed-artifact/ToolContextService.js';
import { contextInboxPath, validateContextInboxCandidate } from './CaptureInboxBoundary.js';
import { CaptureRoutingCoordinator } from './CaptureRoutingCoordinator.js';

export function isTemporaryToolFile(name: string): boolean {
  return /\.(?:tmp|dwl|dwl2)$/i.test(name) || name.toLowerCase() === 'acad.err';
}

interface ActiveInbox {
  watcher: FSWatcher | null;
  timer: NodeJS.Timeout;
}

export class CaptureInboxCoordinator {
  private readonly active = new Map<string, ActiveInbox>();
  private readonly processing = new Map<string, Promise<void>>();
  private closed = false;

  public constructor(
    private readonly dataRoot: string,
    private readonly contexts: ToolContextService,
    private readonly routing: CaptureRoutingCoordinator,
    private readonly pollIntervalMs = 2_000,
  ) {}

  public async start(): Promise<void> {
    await this.routing.recoverNonterminal();
    for (const context of this.contexts.list()) {
      if (toolContextCanAuthorizeNewCapture(context.state)) this.activate(context);
    }
  }

  public activate(context: ToolContext): void {
    if (this.closed || !toolContextCanAuthorizeNewCapture(context.state)) return;
    this.deactivate(context.toolContextId);
    const timer = setInterval(
      () => void this.reconcileContext(context.toolContextId),
      this.pollIntervalMs,
    );
    timer.unref?.();
    this.active.set(context.toolContextId, { watcher: null, timer });
    void this.reconcileContext(context.toolContextId);
  }

  public deactivate(toolContextId: string): void {
    const current = this.active.get(toolContextId);
    if (!current) return;
    current.watcher?.close();
    clearInterval(current.timer);
    this.active.delete(toolContextId);
  }

  public async reconcileContext(toolContextId: string): Promise<void> {
    if (this.closed || !this.active.has(toolContextId)) return;
    const context = this.contexts.get(toolContextId);
    if (!toolContextCanAuthorizeNewCapture(context.state)) {
      this.deactivate(toolContextId);
      return;
    }
    const inbox = contextInboxPath(this.dataRoot, toolContextId);
    this.ensureWatcher(toolContextId, inbox);
    let entries;
    try {
      entries = await readdir(inbox, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || isTemporaryToolFile(entry.name)) continue;
      const candidate = path.join(inbox, entry.name);
      const contained = await validateContextInboxCandidate(
        this.dataRoot,
        toolContextId,
        candidate,
      );
      if (!contained) continue;
      const key = `${toolContextId}\0${contained.toLowerCase()}`;
      const preceding = this.processing.get(key) ?? Promise.resolve();
      const next = preceding
        .catch(() => undefined)
        .then(async () => {
          const latest = this.contexts.get(toolContextId);
          if (!toolContextCanAuthorizeNewCapture(latest.state)) return;
          await this.routing.admitInboxCandidate(latest, contained);
        })
        .catch(() => undefined)
        .finally(() => {
          if (this.processing.get(key) === next) this.processing.delete(key);
        });
      this.processing.set(key, next);
    }
  }

  public async close(): Promise<void> {
    this.closed = true;
    for (const id of [...this.active.keys()]) this.deactivate(id);
    await Promise.allSettled(this.processing.values());
    this.processing.clear();
  }

  private ensureWatcher(toolContextId: string, inbox: string): void {
    const current = this.active.get(toolContextId);
    if (!current || current.watcher) return;
    try {
      current.watcher = watch(inbox, { persistent: false }, () => {
        void this.reconcileContext(toolContextId);
      });
      current.watcher.on('error', () => {
        current.watcher?.close();
        current.watcher = null;
      });
    } catch {
      // fs.watch is a hint only. Bounded periodic reconciliation remains the
      // durable detection authority and will retry watcher setup later.
    }
  }
}
