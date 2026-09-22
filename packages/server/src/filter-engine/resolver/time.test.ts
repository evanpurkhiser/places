import {afterEach, expect, it, vi} from 'vitest';

import {createDatabase} from '../../db/index.ts';
import {createContext} from '../context.ts';

import {timeResolver} from './time.ts';

const db = createDatabase('postgres://localhost/unused');

afterEach(() => vi.useRealTimers());

it('resolves @now from the time captured by the query context', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const context = createContext(db);
  vi.setSystemTime(2000);

  expect(timeResolver.resolveReference('now', context)).toEqual({
    kind: 'instant',
    epochMilliseconds: 1000,
  });
  expect(timeResolver.resolveReference('now', createContext(db))).toEqual({
    kind: 'instant',
    epochMilliseconds: 2000,
  });
});

it('rejects unknown time references', () => {
  expect(() => timeResolver.resolveReference('tomorrow', createContext(db))).toThrow(
    'Unknown time reference',
  );
});
