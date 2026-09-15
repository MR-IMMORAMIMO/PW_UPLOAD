import { readFile, writeFile } from 'node:fs/promises';

const template = await readFile('env/.env.example', 'utf8');
await writeFile('env/.env.local', template, 'utf8');
process.stdout.write('Prepared non-secret local manifest validation values.\n');
