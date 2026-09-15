import { createRequire } from 'node:module';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppUser } from '@scli/domain';
import { ImportInspectionService } from '../apps/api/src/infrastructure/imports/ImportInspectionService';
import { ImportSessionStore } from '../apps/api/src/infrastructure/imports/ImportSessionStore';
import { ImportSourceAdmission } from '../apps/api/src/infrastructure/imports/ImportSourceAdmission';
import { applyV24SmartImportInspection } from '../apps/api/src/infrastructure/migration/registry/production-v24-smart-import-inspection';

const require = createRequire(import.meta.url);
const bridge = require('./external-application-bridge.cjs') as {
  configureApplication(application: string, executablePath: string, dataRoot: string): unknown;
  launchApplication(
    input: unknown,
    dataRoot: string,
    spawnProcess: (...args: unknown[]) => unknown,
  ): {
    inboxPath: string;
  };
  listApplicationStatus(
    dataRoot: string,
    environment?: NodeJS.ProcessEnv,
  ): Array<{
    application: string;
    available: boolean;
  }>;
  prepareSessionInbox(dataRoot: string, toolContextId: string): string;
  executeDesktopHandoff(
    input: { handoffId: string; expectedAction: string },
    dataRoot: string,
    handlers?: Record<string, unknown>,
  ): Promise<unknown>;
};

const roots: string[] = [];
const actor: AppUser = {
  id: '11111111-1111-4111-8111-111111111111',
  entraObjectId: 'standalone:owner',
  displayName: 'Workspace Owner',
  email: 'owner@example.com',
  jobTitle: 'Owner',
  department: 'Lighting',
  role: 'Admin',
  weeklyCapacityHours: 40,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
};
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), 'scli-p4a-desktop-'));
  roots.push(value);
  return value;
}

describe('Phase 4A narrow desktop integration bridge', () => {
  it('keeps executable selection in Desktop main and exposes no generic command bridge', () => {
    const main = readFileSync(path.join(process.cwd(), 'desktop', 'main.cjs'), 'utf8');
    const preload = readFileSync(path.join(process.cwd(), 'desktop', 'preload.cjs'), 'utf8');
    expect(main).toContain("ipcMain.handle('scli:configure-integration'");
    expect(main).toContain('rememberedOpenDialog(dialog,');
    expect(main).toContain("app.getPath('userData'), 'picker-directories.json'");
    expect(preload).toContain('configureIntegration: (application) =>');
    expect(preload).not.toMatch(/exec\s*:\s*|shell\s*:\s*|command\s*:\s*/);
  });

  it('persists only allow-listed executable identities and prepares a UUID-owned inbox', () => {
    const dataRoot = root();
    const executable = path.join(dataRoot, 'acad.exe');
    writeFileSync(executable, 'fixture');
    bridge.configureApplication('AUTOCAD', executable, dataRoot);
    expect(bridge.listApplicationStatus(dataRoot, {})).toContainEqual(
      expect.objectContaining({ application: 'AUTOCAD', available: true }),
    );
    const inbox = bridge.prepareSessionInbox(dataRoot, 'a0000000-0000-4000-8000-000000000001');
    expect(existsSync(inbox)).toBe(true);
    expect(() => bridge.prepareSessionInbox(dataRoot, '..')).toThrow(/UUID/);
    expect(() => bridge.configureApplication('DIALUX', executable, dataRoot)).toThrow(/not valid/);
  });

  it('launches without a shell and accepts only application-specific source files', () => {
    const dataRoot = root();
    const executable = path.join(dataRoot, 'acad.exe');
    const projectRoot = path.join(dataRoot, 'Project');
    const projectId = 'b0000000-0000-4000-8000-000000000001';
    mkdirSync(projectRoot);
    writeFileSync(
      path.join(projectRoot, '.scli-project.json'),
      JSON.stringify({ schemaVersion: 1, projectId }),
    );
    const drawing = path.join(projectRoot, 'lighting.dwg');
    const pdf = path.join(projectRoot, 'random.pdf');
    writeFileSync(executable, 'fixture');
    writeFileSync(drawing, 'dwg');
    writeFileSync(pdf, 'pdf');
    bridge.configureApplication('AUTOCAD', executable, dataRoot);
    const unref = vi.fn();
    const spawnProcess = vi.fn(() => ({ unref }));
    const launched = bridge.launchApplication(
      {
        application: 'AUTOCAD',
        toolContextId: 'a0000000-0000-4000-8000-000000000002',
        projectId,
        authorizedProjectRoot: projectRoot,
        sourcePath: drawing,
      },
      dataRoot,
      spawnProcess,
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      executable,
      [drawing],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
    expect(unref).toHaveBeenCalled();
    expect(existsSync(launched.inboxPath)).toBe(true);
    expect(() =>
      bridge.launchApplication(
        {
          application: 'AUTOCAD',
          toolContextId: 'a0000000-0000-4000-8000-000000000003',
          projectId,
          authorizedProjectRoot: projectRoot,
          sourcePath: pdf,
        },
        dataRoot,
        spawnProcess,
      ),
    ).toThrow(/not an eligible/);
    expect(() =>
      bridge.launchApplication(
        {
          application: 'AUTOCAD',
          toolContextId: 'a0000000-0000-4000-8000-000000000004',
          projectId: 'b0000000-0000-4000-8000-000000000099',
          authorizedProjectRoot: projectRoot,
          sourcePath: drawing,
        },
        dataRoot,
        spawnProcess,
      ),
    ).toThrow(/not verified/);
  });

  it('does not silently replace a missing selected AutoCAD with another discovery', () => {
    const dataRoot = root();
    const selected = path.join(dataRoot, 'acad.exe');
    writeFileSync(selected, 'fixture');
    bridge.configureApplication('AUTOCAD', selected, dataRoot);
    unlinkSync(selected);
    const programFiles = path.join(dataRoot, 'Program Files');
    const alternative = path.join(programFiles, 'Autodesk', 'AutoCAD 2027', 'acad.exe');
    mkdirSync(path.dirname(alternative), { recursive: true });
    writeFileSync(alternative, 'fixture');
    expect(bridge.listApplicationStatus(dataRoot, { ProgramFiles: programFiles })).toContainEqual(
      expect.objectContaining({
        application: 'AUTOCAD',
        available: false,
        health: 'SELECTED_VERSION_MISSING',
        discoveries: [expect.objectContaining({ executablePath: alternative, version: '2027' })],
      }),
    );
  });

  it('consumes opaque handoffs once and rejects expiry or a wrong action', async () => {
    const dataRoot = root();
    const pending = path.join(dataRoot, 'desktop-handoffs', 'pending');
    mkdirSync(pending, { recursive: true });
    const writeHandoff = (id: string, action: string, expiresAt: string) =>
      writeFileSync(
        path.join(pending, `${id}.json`),
        JSON.stringify({
          schemaVersion: 1,
          handoffId: id,
          action,
          expiresAt,
          payload: { action, application: 'AUTOCAD' },
        }),
      );
    const configured = path.join(dataRoot, 'acad.exe');
    writeFileSync(configured, 'fixture');
    bridge.configureApplication('AUTOCAD', configured, dataRoot);
    const valid = 'a0000000-0000-4000-8000-000000000010';
    writeHandoff(valid, 'TEST_LAUNCH', new Date(Date.now() + 60_000).toISOString());
    await expect(
      bridge.executeDesktopHandoff({ handoffId: valid, expectedAction: 'TEST_LAUNCH' }, dataRoot, {
        spawnProcess: vi.fn(() => ({ unref: vi.fn() })),
      }),
    ).resolves.toEqual(expect.objectContaining({ launchRequested: true }));
    await expect(
      bridge.executeDesktopHandoff({ handoffId: valid, expectedAction: 'TEST_LAUNCH' }, dataRoot),
    ).rejects.toThrow(/already consumed/);

    const wrong = 'a0000000-0000-4000-8000-000000000011';
    writeHandoff(wrong, 'TEST_LAUNCH', new Date(Date.now() + 60_000).toISOString());
    await expect(
      bridge.executeDesktopHandoff(
        { handoffId: wrong, expectedAction: 'OPEN_EXPORT_FOLDER' },
        dataRoot,
      ),
    ).rejects.toThrow(/wrong action/);

    const expired = 'a0000000-0000-4000-8000-000000000012';
    writeHandoff(expired, 'TEST_LAUNCH', new Date(Date.now() - 1).toISOString());
    await expect(
      bridge.executeDesktopHandoff({ handoffId: expired, expectedAction: 'TEST_LAUNCH' }, dataRoot),
    ).rejects.toThrow(/expired/);
  });

  it('keeps manual picker paths inside Desktop and enforces the server extension allow-list', async () => {
    const dataRoot = root();
    const contextId = 'a0000000-0000-4000-8000-000000000020';
    const inbox = bridge.prepareSessionInbox(dataRoot, contextId);
    const pending = path.join(dataRoot, 'desktop-handoffs', 'pending');
    mkdirSync(pending, { recursive: true });
    const writePicker = (handoffId: string) =>
      writeFileSync(
        path.join(pending, `${handoffId}.json`),
        JSON.stringify({
          schemaVersion: 1,
          handoffId,
          action: 'MANUAL_FILE_PICK',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          payload: {
            action: 'MANUAL_FILE_PICK',
            projectId: 'b0000000-0000-4000-8000-000000000001',
            toolContextId: contextId,
            inboxPath: inbox,
            allowedExtensions: ['.dwg'],
          },
        }),
      );
    const rejected = path.join(dataRoot, 'selected.pdf');
    writeFileSync(rejected, 'pdf');
    const rejectedId = 'a0000000-0000-4000-8000-000000000021';
    writePicker(rejectedId);
    await expect(
      bridge.executeDesktopHandoff(
        { handoffId: rejectedId, expectedAction: 'MANUAL_FILE_PICK' },
        dataRoot,
        { pickFile: async () => rejected },
      ),
    ).rejects.toThrow(/not eligible/);

    const selected = path.join(dataRoot, 'selected.dwg');
    writeFileSync(selected, 'dwg');
    const acceptedId = 'a0000000-0000-4000-8000-000000000022';
    writePicker(acceptedId);
    const result = await bridge.executeDesktopHandoff(
      { handoffId: acceptedId, expectedAction: 'MANUAL_FILE_PICK' },
      dataRoot,
      { pickFile: async () => selected },
    );
    expect(result).toEqual({ action: 'MANUAL_FILE_PICK', accepted: true });
    expect(JSON.stringify(result)).not.toContain(selected);
    expect(existsSync(path.join(inbox, 'selected.dwg'))).toBe(true);
  });

  it('copies a bounded Smart Import source into its UUID-owned inbox without returning a path', async () => {
    const dataRoot = root();
    const importSessionId = 'a0000000-0000-4000-8000-000000000030';
    const inbox = path.join(dataRoot, 'import-stage', importSessionId, 'desktop-inbox');
    mkdirSync(inbox, { recursive: true });
    const pending = path.join(dataRoot, 'desktop-handoffs', 'pending');
    mkdirSync(pending, { recursive: true });
    const handoffId = 'a0000000-0000-4000-8000-000000000031';
    writeFileSync(
      path.join(pending, `${handoffId}.json`),
      JSON.stringify({
        schemaVersion: 1,
        handoffId,
        action: 'SELECT_IMPORT_SOURCE',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        payload: {
          action: 'SELECT_IMPORT_SOURCE',
          importSessionId,
          inboxPath: inbox,
          allowedExtensions: ['.csv', '.tsv', '.xlsx'],
        },
      }),
    );
    const selected = path.join(dataRoot, 'DIALux export.csv');
    writeFileSync(selected, 'Luminaire\tWattage\nDL01\t12 W');
    const result = await bridge.executeDesktopHandoff(
      { handoffId, expectedAction: 'SELECT_IMPORT_SOURCE' },
      dataRoot,
      { pickFile: async () => selected },
    );
    expect(result).toEqual({ action: 'SELECT_IMPORT_SOURCE', accepted: true });
    expect(JSON.stringify(result)).not.toContain(selected);
    expect(readFileSync(path.join(inbox, 'DIALux export.csv'), 'utf8')).toContain('DL01');
  });

  it('copies one bounded PDF into its admission inbox and returns only opaque status', async () => {
    const dataRoot = root();
    const admissionId = 'a0000000-0000-4000-8000-000000000040';
    const inbox = path.join(dataRoot, 'document-store', 'staging', admissionId, 'desktop-inbox');
    mkdirSync(inbox, { recursive: true });
    const pending = path.join(dataRoot, 'desktop-handoffs', 'pending');
    mkdirSync(pending, { recursive: true });
    const handoffId = 'a0000000-0000-4000-8000-000000000041';
    writeFileSync(
      path.join(pending, `${handoffId}.json`),
      JSON.stringify({
        schemaVersion: 1,
        handoffId,
        action: 'SELECT_DOCUMENT_PDF',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        payload: {
          action: 'SELECT_DOCUMENT_PDF',
          admissionId,
          inboxPath: inbox,
          allowedExtensions: ['.pdf'],
        },
      }),
    );
    const selected = path.join(dataRoot, 'Selected calculation.pdf');
    const bytes = Buffer.from('%PDF-1.4\nopaque desktop fixture\n%%EOF');
    writeFileSync(selected, bytes);
    const result = await bridge.executeDesktopHandoff(
      { handoffId, expectedAction: 'SELECT_DOCUMENT_PDF' },
      dataRoot,
      { pickFile: async () => selected },
    );
    expect(result).toEqual({ action: 'SELECT_DOCUMENT_PDF', accepted: true });
    expect(JSON.stringify(result)).not.toContain(selected);
    expect(readFileSync(path.join(inbox, path.basename(selected)))).toEqual(bytes);
  });

  it('copies one bounded Project source into its admission inbox and returns only opaque status', async () => {
    const dataRoot = root();
    const projectId = 'a0000000-0000-4000-8000-000000000050';
    const admissionId = 'a0000000-0000-4000-8000-000000000051';
    const projectRoot = path.join(dataRoot, 'project-root');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(
      path.join(projectRoot, '.scli-project.json'),
      JSON.stringify({ schemaVersion: 1, projectId, createdAt: '2026-08-29T00:00:00.000Z' }),
    );
    const inbox = path.join(dataRoot, 'project-sources', 'pending', admissionId);
    mkdirSync(inbox, { recursive: true });
    const pending = path.join(dataRoot, 'desktop-handoffs', 'pending');
    mkdirSync(pending, { recursive: true });
    const handoffId = 'a0000000-0000-4000-8000-000000000052';
    writeFileSync(
      path.join(pending, `${handoffId}.json`),
      JSON.stringify({
        schemaVersion: 1,
        handoffId,
        action: 'SELECT_PROJECT_SOURCE',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        payload: {
          action: 'SELECT_PROJECT_SOURCE',
          projectId,
          admissionId,
          inboxPath: inbox,
          allowedExtensions: ['.dwg', '.dxf'],
          maximumBytes: 200 * 1024 * 1024,
          authorizedProjectRoot: projectRoot,
        },
      }),
    );
    const selected = path.join(projectRoot, 'plan.dwg');
    const bytes = Buffer.from('opaque project source fixture');
    writeFileSync(selected, bytes);
    const result = await bridge.executeDesktopHandoff(
      { handoffId, expectedAction: 'SELECT_PROJECT_SOURCE' },
      dataRoot,
      { pickFile: async () => selected },
    );
    expect(result).toEqual({ action: 'SELECT_PROJECT_SOURCE', accepted: true });
    expect(JSON.stringify(result)).not.toContain(selected);
    expect(readFileSync(path.join(inbox, 'plan.dwg'))).toEqual(bytes);
  });

  it('admits and durably inspects the exact Desktop-staged file through a junction data root', async () => {
    const physicalRoot = root();
    const aliasParent = root();
    const dataRoot = path.join(aliasParent, 'Workspace Data');
    try {
      symlinkSync(physicalRoot, dataRoot, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? ''))
        return;
      throw error;
    }

    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    applyV24SmartImportInspection(database);
    const admission = new ImportSourceAdmission(dataRoot);
    const store = new ImportSessionStore(database, () => new Date('2026-08-27T00:00:00.000Z'));
    const inspection = new ImportInspectionService(store, admission);
    const session = inspection.create(
      { destinationMode: 'PROJECT', projectId: '22222222-2222-4222-8222-222222222222' },
      actor,
    );
    const inbox = admission.prepareDesktopInbox(session.importSessionId);
    const handoffId = 'a0000000-0000-4000-8000-000000000032';
    const pending = path.join(dataRoot, 'desktop-handoffs', 'pending');
    mkdirSync(pending, { recursive: true });
    writeFileSync(
      path.join(pending, `${handoffId}.json`),
      JSON.stringify({
        schemaVersion: 1,
        handoffId,
        action: 'SELECT_IMPORT_SOURCE',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        payload: {
          action: 'SELECT_IMPORT_SOURCE',
          importSessionId: session.importSessionId,
          inboxPath: inbox,
          allowedExtensions: ['.csv', '.tsv', '.xlsx'],
        },
      }),
    );
    const selected = path.join(aliasParent, 'DIALux source with spaces.csv');
    const bytes = Buffer.from(
      [
        'TAGText;ManufNameText;ArticleNumberText;ConnectedLoadText;LuminaireLuminousFluxText;CCTText',
        'Type / Tag;Manufacturer;Article Number;Connected Load [W];Luminaire Luminous Flux [lm];CCT [K]',
        'DL01;ERCO;ABC;4,4;242;3000',
      ].join('\n'),
    );
    writeFileSync(selected, bytes);

    await expect(
      bridge.executeDesktopHandoff(
        { handoffId, expectedAction: 'SELECT_IMPORT_SOURCE' },
        dataRoot,
        { pickFile: async () => selected },
      ),
    ).resolves.toEqual({ action: 'SELECT_IMPORT_SOURCE', accepted: true });
    const stagedFile = path.join(inbox, path.basename(selected));
    expect(lstatSync(stagedFile).isFile()).toBe(true);
    expect(lstatSync(stagedFile).isDirectory()).toBe(false);
    expect(lstatSync(stagedFile).isSymbolicLink()).toBe(false);
    expect(readFileSync(stagedFile)).toEqual(bytes);
    expect(realpathSync.native(stagedFile).toLowerCase()).not.toBe(
      path.resolve(stagedFile).toLowerCase(),
    );

    const inspected = await inspection.inspectDesktopSelection(session.importSessionId);
    expect(inspected.detectedAdapterId).toBe('DIALUX_NATIVE_CSV');
    expect(inspected.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(inspected.counts.total).toBe(1);
    expect(store.get(session.importSessionId).sourceSha256).toBe(inspected.sourceSha256);
    expect(existsSync(path.join(dataRoot, 'import-stage', session.importSessionId))).toBe(false);
    database.close();
  });
});
