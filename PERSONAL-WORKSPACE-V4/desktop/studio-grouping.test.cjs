const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

const context = { module: { exports: {} } };
runInNewContext(
  readFileSync(join(__dirname, '../tools/luminaire-studio-v1.4.1/core.js'), 'utf8'),
  context,
);
const { groupRows } = context.module.exports;

test('empty grouping levels keep every row without repeated placeholder headings', () => {
  const records = [{ tag: 'DL01', scope: '', floor: '', area: '' }, { tag: 'DL02' }];
  const result = groupRows(records, ['scope', 'floor', 'area']);
  assert.equal(result.length, 2);
  assert.ok(result.every((entry) => entry.kind === 'item'));
  assert.equal(result[0].record, records[0]);
  assert.equal(result[1].record, records[1]);
});

test('named child groups survive an empty parent and mixed ungrouped rows remain present', () => {
  const records = [
    { tag: 'DL01', floor: 'Ground' },
    { tag: 'DL02', scope: 'Indoor', floor: 'First' },
    { tag: 'DL03' },
  ];
  const result = groupRows(records, ['scope', 'floor']);
  assert.deepEqual(
    Array.from(
      result.filter((entry) => entry.kind === 'group'),
      (entry) => entry.label,
    ),
    ['Indoor', 'First', 'Ground'],
  );
  assert.equal(result.filter((entry) => entry.kind === 'item').length, 3);
});
