import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CaptureNamingService } from './infrastructure/automation/CaptureNamingService';
import {
  createP4bCapabilityRegistry,
  findP4bCapturePolicy,
  P4B_CAPTURE_CHANNEL,
  P4B_CAPTURE_MODE,
  policyAcceptsFile,
} from './infrastructure/automation/CapturePolicy';
import {
  contextInboxPath,
  validateContextInboxCandidate,
} from './infrastructure/automation/CaptureInboxBoundary';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('P4B exact policy, naming, and controlled ingress', () => {
  it('registers only the three exact capabilities and exact extensions', () => {
    const registry = createP4bCapabilityRegistry();
    expect(
      registry.findExact('DIALUX', 'DIALUX_REPORT', P4B_CAPTURE_MODE, P4B_CAPTURE_CHANNEL),
    ).toMatchObject({ operational: true, sourceClass: 'AUTOMATIC_CAPTURE' });
    expect(
      registry.findExact('AUTOCAD', 'CAD_LAYOUT_PDF', P4B_CAPTURE_MODE, P4B_CAPTURE_CHANNEL),
    ).toBeDefined();
    expect(
      registry.findExact('AUTOCAD', 'CAD_WORKING_DRAWING', P4B_CAPTURE_MODE, P4B_CAPTURE_CHANNEL),
    ).toBeDefined();
    expect(
      registry.findExact('AUTOCAD', 'ANY_PDF', P4B_CAPTURE_MODE, P4B_CAPTURE_CHANNEL),
    ).toBeUndefined();
    const working = findP4bCapturePolicy('AUTOCAD', 'CAD_WORKING_DRAWING')!;
    expect(policyAcceptsFile(working, 'model.dwg')).toBe(true);
    expect(policyAcceptsFile(working, 'model.DXF')).toBe(true);
    expect(policyAcceptsFile(working, 'model.pdf')).toBe(false);
  });

  it('builds deterministic Windows-safe names without truncating identity', () => {
    const naming = new CaptureNamingService();
    const dialux = findP4bCapturePolicy('DIALUX', 'DIALUX_REPORT')!;
    expect(
      naming.canonicalFileName({
        projectCode: '001_SCT/CON',
        revisionLabel: 'REV_04',
        policy: dialux,
        matchedExtension: '.pdf',
      }),
    ).toBe('001_SCT_CON_DIALUX_REPORT_REV_04.pdf');
    expect(
      naming.canonicalFileName(
        {
          projectCode: '001_SCT',
          revisionLabel: 'REV_04',
          policy: dialux,
          matchedExtension: '.pdf',
        },
        2,
      ),
    ).toBe('001_SCT_DIALUX_REPORT_REV_04_A02.pdf');
    expect(() =>
      naming.canonicalFileName({
        projectCode: 'X'.repeat(110),
        revisionLabel: 'REV_04',
        policy: dialux,
        matchedExtension: '.pdf',
      }),
    ).toThrow(/DESTINATION_PATH_TOO_LONG/);
  });

  it('admits only a direct regular non-link child after realpath containment', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'scli-p4b-boundary-'));
    roots.push(root);
    const contextId = '10000000-0000-4000-8000-000000000001';
    const inbox = contextInboxPath(root, contextId);
    await mkdir(inbox, { recursive: true });
    const direct = path.join(inbox, 'report.pdf');
    await writeFile(direct, 'report');
    expect(await validateContextInboxCandidate(root, contextId, direct)).toBe(
      await import('node:fs/promises').then(({ realpath }) => realpath(direct)),
    );

    const nested = path.join(inbox, 'nested');
    await mkdir(nested);
    const nestedFile = path.join(nested, 'layout.pdf');
    await writeFile(nestedFile, 'nested');
    expect(await validateContextInboxCandidate(root, contextId, nestedFile)).toBeNull();

    const outside = path.join(root, 'outside.pdf');
    await writeFile(outside, 'outside');
    const link = path.join(inbox, 'escape.pdf');
    try {
      await symlink(outside, link, 'file');
      expect(await validateContextInboxCandidate(root, contextId, link)).toBeNull();
    } catch {
      // Windows developer-mode policy may disallow symlink creation; direct and
      // nested containment assertions still exercise the production boundary.
    }
  });
});
