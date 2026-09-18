import peggy from 'peggy';

import {readFile, writeFile} from 'node:fs/promises';

const directory = new URL('../src/search/', import.meta.url);
const grammar = await readFile(new URL('grammar.pegjs', directory), 'utf8');
const output = peggy.generate(grammar, {output: 'source', format: 'es', cache: true});
const target = new URL('generated.js', directory);

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8');

  if (current !== output) {
    throw new Error(
      'Search parser is stale. Run pnpm --filter @places/common generate:search',
    );
  }
} else {
  await writeFile(target, output);
}
