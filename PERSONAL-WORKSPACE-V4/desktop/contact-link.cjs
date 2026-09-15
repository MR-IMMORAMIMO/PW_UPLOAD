'use strict';

/** Only contact protocols; no URLs, message bodies, headers, or arbitrary OS commands. */
function contactLink(input) {
  if (!input || typeof input !== 'object' || typeof input.value !== 'string') return null;
  const value = input.value.trim();
  if (input.kind === 'email') {
    if (value.length > 320 || !/^[^\s@?&#:%]+@[^\s@?&#:%]+\.[^\s@?&#:%]+$/.test(value)) return null;
    return `mailto:${encodeURIComponent(value).replace('%40', '@')}`;
  }
  if (input.kind === 'phone') {
    if (value.length > 64 || !/^\+?[0-9 ().-]{3,64}$/.test(value)) return null;
    return `tel:${encodeURIComponent(value.replace(/[ ().-]/g, ''))}`;
  }
  return null;
}
module.exports = { contactLink };
