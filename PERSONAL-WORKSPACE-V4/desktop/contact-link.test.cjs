const test = require('node:test');
const assert = require('node:assert/strict');
const { contactLink } = require('./contact-link.cjs');
test('contact links encode only validated addresses and numbers', () => {
  assert.equal(
    contactLink({ kind: 'email', value: 'person@example.test' }),
    'mailto:person@example.test',
  );
  assert.equal(contactLink({ kind: 'phone', value: '+971 50 123-4567' }), 'tel:%2B971501234567');
});
test('rejects protocols, email headers, newlines, and arbitrary link kinds', () => {
  for (const value of [
    'file:///C:/Windows',
    'person@example.test?body=message',
    'person@example.test\r\nBcc:someone@example.test',
    'person%0a@example.test',
  ])
    assert.equal(contactLink({ kind: 'email', value }), null);
  for (const value of ['+971;ext=1', 'javascript:alert(1)', '123\n456'])
    assert.equal(contactLink({ kind: 'phone', value }), null);
  assert.equal(contactLink({ kind: 'command', value: 'calc.exe' }), null);
});
