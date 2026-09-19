import {expect, it} from 'vitest';

import {createDatabase} from '../db/index.ts';

import {compilePlaceQuery, placeFilterEngine} from './index.ts';

const db = createDatabase('postgres://localhost/unused');

it('rejects competing interval endpoints during preparation', () => {
  expect(() => placeFilterEngine.prepare('open[@now, for:2h, until:@now]')).toThrow(
    'either for or until',
  );
});

it.each([
  ['open[@now, until:"mon 6pm"]', 'same kind'],
  ['open["mon 6pm", until:8pm]', 'same kind'],
  ['open["mon 6pm", until:"mon 6pm"]', 'distinct weekly'],
  ['open[6pm, until:2am]', 'later than'],
  ['open[@now, until:@now]', 'later than'],
  ['open[@now, for:745h]', 'up to 31 days'],
  ['open["2026-09-21T18:00:00Z", until:"2026-09-20T18:00:00Z"]', 'later than'],
])('rejects invalid interval %s', async (query, message) => {
  await expect(compilePlaceQuery(query, {db})).rejects.toThrow(message);
});

it('prepares every documented open example', () => {
  const docs = placeFilterEngine
    .describe()
    .filters.find(filter => filter.name === 'open');

  for (const example of docs!.examples) {
    expect(() => placeFilterEngine.prepare(example.query)).not.toThrow();
  }
});
