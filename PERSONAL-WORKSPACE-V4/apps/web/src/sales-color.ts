export function salesTone(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized || /^(unassigned|unknown|direct)$/i.test(normalized)) return 'sales-tone-neutral';
  let hash = 0;
  for (const character of normalized) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `sales-tone-${hash % 8}`;
}
