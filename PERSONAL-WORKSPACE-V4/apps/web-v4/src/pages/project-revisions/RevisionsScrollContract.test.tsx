/** @vitest-environment jsdom */
/**
 * Corrective delta (Fix D): internal scroll ownership contract.
 *
 * The Revisions & Outputs page is a bounded V4 desktop workspace. The shell
 * owns the viewport; the page consumes the remaining height; primary collections
 * paginate while detail inspectors may scroll. No nested viewport owner and no document
 * X overflow.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { V4Router } from '../../router/V4Router';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'corr-1' },
    json: () => Promise.resolve(body),
  };
}

function mockFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.endsWith('/workspace')) {
      return Promise.resolve(jsonResponse({ data: { projectId: PROJECT_ID, folderPath: null } }));
    }
    if (url.endsWith('/revisions')) {
      return Promise.resolve(jsonResponse({ data: [] }));
    }
    if (url.endsWith('/outputs')) {
      return Promise.resolve(jsonResponse({ data: [] }));
    }
    return Promise.resolve(jsonResponse({ data: {} }));
  });
}

// Read the compiled CSS rules as a plain text source to assert the structural
// contract. jsdom cannot compute layout, so we protect the load-bearing rules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const stylesPath = join(process.cwd(), 'src', 'styles-v4.css');
const css = readFileSync(stylesPath, 'utf8');

describe('Revisions & Outputs scroll contract (Fix D)', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('page renders inside the bounded shell page', async () => {
    stubMatchMedia();
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderV4(<V4Router />, [`/projects/${PROJECT_ID}/revisions`]);
    const shell = await screen.findByTestId('v4-shell');
    expect(shell).toBeInTheDocument();
  });

  it('no nested 100vh/100dvh viewport owner is introduced for the page', () => {
    // Extract only the Revisions-and-Outputs-scroll block (Fix D section).
    const blockStart = css.indexOf('Revisions & Outputs — internal scroll ownership');
    expect(blockStart).toBeGreaterThan(-1);
    // Bound the slice to the Fix D media query (ends at the first top-level
    // closing brace that closes the @media block). Handle CRLF and LF.
    let blockEnd = css.indexOf('\n}\n', blockStart);
    if (blockEnd === -1) blockEnd = css.indexOf('\r\n}\r\n', blockStart);
    const scrollBlock =
      blockStart >= 0 && blockEnd > blockStart
        ? css.slice(blockStart, blockEnd + 3)
        : css.slice(blockStart);
    // No nested viewport owner anywhere in the scroll rules we added.
    expect(scrollBlock).not.toContain('100vh');
    expect(scrollBlock).not.toContain('100dvh');
    // Height is delegated to the bounded shell via percentage/min-height:0.
    expect(scrollBlock).toMatch(/height:\s*100%/);
  });

  it('primary collection does not own vertical scroll and inspector may scroll internally', () => {
    expect(css).toMatch(
      /\.v4-revisions\s*>\s*\.v4-split-pane\s+\.v4-revisions__main-card\s*\{[^}]*overflow:\s*hidden/s,
    );
    expect(css).toMatch(/\.v4-revisions__table-scroll\s*\{[^}]*overflow-y:\s*visible/s);
    expect(css).toMatch(
      /\.v4-revisions\s*>\s*\.v4-split-pane\s+\.v4-revisions__inspector\s*\{[^}]*overflow:\s*auto/s,
    );
  });

  it('no document-level X overflow rule is introduced for the page', () => {
    const blockStart = css.indexOf('Revisions & Outputs — internal scroll ownership');
    const scrollBlock = css.slice(blockStart);
    expect(scrollBlock).not.toMatch(/overflow-x:\s*(scroll|hidden)/);
  });

  it('table bodies are page-bounded and horizontally resilient', () => {
    expect(css).toMatch(/\.v4-revisions__main-card\s*\{[^}]*min-height:\s*0/s);
    expect(css).toMatch(/\.v4-revisions__table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.v4-revisions\s*>\s*\.v4-split-pane\s*\{[^}]*overflow:\s*hidden/s);
  });
});
