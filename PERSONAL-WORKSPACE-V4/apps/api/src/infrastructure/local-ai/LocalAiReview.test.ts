import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { compareReading, LocalAiReview } from './LocalAiReview';
import { LocalVisionAdapter } from './LocalVisionAdapter';
import { PdfExtractionAdapter } from '../document-intelligence/PdfExtractionAdapter';
import type { LocalAiPageReading } from '@scli/contracts';

const reading: LocalAiPageReading = {
  productCode: 'A100',
  summary: 'A fixture',
  observations: [],
  fields: [{ field: 'wattage', value: '21 W', quote: 'System power: 21 W' }],
};
describe('local-only review boundaries', () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });
  it('compares supported quoted system power without adopting any Project values', () => {
    const snapshot = { orderingCode: 'A100', wattage: '18 W' };
    expect(
      compareReading(reading, 'Ordering code: A100. System power: 21 W', snapshot)[0]?.result,
    ).toBe('DIFFERENT_EVIDENCE');
    expect(snapshot.wattage).toBe('18 W');
  });
  it.each([
    ['wrong product', { ...reading, productCode: 'B200' }, 'System power: 21 W', '21 W'],
    ['unquoted evidence', reading, 'Some other text', '21 W'],
    ['range in Project', reading, 'System power: 21 W', '18–21 W'],
    [
      'range in Datasheet',
      {
        ...reading,
        fields: [{ field: 'wattage' as const, value: '18–21 W', quote: 'Power 18–21 W' }],
      },
      'Power 18–21 W',
      '18 W',
    ],
  ])('keeps %s unverified', (_label, content, text, wattage) => {
    expect(compareReading(content, text, { orderingCode: 'A100', wattage })[0]?.result).toBe(
      'NEEDS_REVIEW',
    );
  });
  it('rejects remote-backed model metadata before sending document content', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ models: [{ name: 'qwen3-vl:2b-instruct', size: 2e9, digest: 'test' }] }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ capabilities: ['vision'], remote_host: 'cloud.example' })),
      );
    await expect(new LocalVisionAdapter(11439, transport).check()).rejects.toThrow(
      'Only an installed local',
    );
    expect(
      transport.mock.calls.every(
        ([url, options]) =>
          String(url).startsWith('http://127.0.0.1:11439/api/') && options?.redirect === 'error',
      ),
    ).toBe(true);
  });
  it('rejects an invalid endpoint port', () => {
    expect(() => new LocalVisionAdapter(0)).toThrow();
  });
  it('does not treat a model-invented code or numeric substring as grounded evidence', () => {
    const content = {
      ...reading,
      productCode: 'A10',
      fields: [{ field: 'wattage' as const, value: '15 W', quote: 'System power: 115 W' }],
    };
    expect(
      compareReading(content, 'Ordering code: A100. System power: 115 W', {
        orderingCode: 'A10',
        wattage: '15 W',
      })[0]?.result,
    ).toBe('NEEDS_REVIEW');
    expect(
      compareReading(
        { ...content, productCode: 'A100' },
        'Ordering code: A100. System power: 115 W',
        { orderingCode: 'A100', wattage: '15 W' },
      )[0]?.result,
    ).toBe('NEEDS_REVIEW');
  });
  it('does not accept CCT misclassified as cutout or LED power as system power', () => {
    const content = {
      ...reading,
      fields: [
        { field: 'cutout' as const, value: '3000 K', quote: 'CCT: 3000 K' },
        { field: 'wattage' as const, value: '18 W', quote: 'LED power: 18 W' },
      ],
    };
    const results = compareReading(content, 'CCT: 3000 K LED power: 18 W', {
      orderingCode: 'A100',
      cutout: '100 mm',
      wattage: '18 W',
    });
    expect(results.every((result) => result.result === 'NEEDS_REVIEW')).toBe(true);
  });
  it('rejects malformed and truncated model results', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ done: true, done_reason: 'length', message: { content: '{}' } }),
        ),
      );
    await expect(
      new LocalVisionAdapter(11439, transport).readPage(
        Buffer.from('image'),
        '',
        'A100',
        new AbortController().signal,
      ),
    ).rejects.toThrow('response limit');
  });
  it('persists results after restart, serializes work, and never modifies its source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'local-ai-review-'));
    roots.push(root);
    const file = path.join(root, 'source.pdf');
    await writeFile(file, 'synthetic');
    const pdf = new PdfExtractionAdapter();
    vi.spyOn(pdf, 'extract').mockResolvedValue({
      pageCount: 1,
      capped: false,
      pages: [
        {
          pageNumber: 1,
          text: 'Ordering code: A100. System power: 21 W',
          needsOcr: false,
          usableTextCharacters: 18,
        },
      ],
    });
    vi.spyOn(pdf, 'renderPage').mockResolvedValue({
      png: Buffer.from('image'),
      width: 1,
      height: 1,
      pageNumber: 1,
    });
    const vision = {
      check: vi.fn().mockResolvedValue({ digest: 'model-digest' }),
      readPage: vi.fn().mockResolvedValue(reading),
      unload: vi.fn().mockResolvedValue(undefined),
    };
    const review = new LocalAiReview(root, vision, pdf);
    const context = {
      projectId: randomUUID(),
      luminaireId: randomUUID(),
      assetVersionId: randomUUID(),
      actorId: randomUUID(),
      sourceHash: createHash('sha256').update('synthetic').digest('hex'),
      file,
      snapshot: { orderingCode: 'A100', wattage: '18 W' },
    };
    await review.start(context);
    await expect(review.start(context)).rejects.toThrow('already running');
    await vi.waitFor(async () =>
      expect((await review.current(context.projectId, context.luminaireId))?.state).toBe(
        'COMPLETED',
      ),
    );
    const reloaded = await new LocalAiReview(root, vision, pdf).current(
      context.projectId,
      context.luminaireId,
    );
    expect(reloaded?.pages[0]?.findings[0]?.result).toBe('DIFFERENT_EVIDENCE');
    expect(await readFile(file, 'utf8')).toBe('synthetic');
    await vi.waitFor(() => expect(vision.unload).toHaveBeenCalled());
  });
  it('rejects changed source bytes without invoking vision', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'local-ai-review-'));
    roots.push(root);
    const file = path.join(root, 'source.pdf');
    await writeFile(file, 'changed');
    const vision = {
      check: vi.fn().mockResolvedValue({ digest: 'model-digest' }),
      readPage: vi.fn(),
      unload: vi.fn().mockResolvedValue(undefined),
    };
    const review = new LocalAiReview(root, vision);
    const context = {
      projectId: randomUUID(),
      luminaireId: randomUUID(),
      assetVersionId: randomUUID(),
      actorId: randomUUID(),
      sourceHash: '0'.repeat(64),
      file,
      snapshot: {},
    };
    await review.start(context);
    await vi.waitFor(async () =>
      expect((await review.current(context.projectId, context.luminaireId))?.state).toBe('FAILED'),
    );
    expect(vision.readPage).not.toHaveBeenCalled();
  });
});
