import {DrizzleQueryError} from 'drizzle-orm';
import {DatabaseError} from 'pg';
import {expect, it} from 'vitest';

import {isUniqueViolation} from './errors.ts';

it('matches only the requested unique constraint on a database query failure', () => {
  const cause = new DatabaseError('duplicate key', 0, 'error');

  cause.code = '23505';
  cause.constraint = 'tags_name_unique';

  const error = new DrizzleQueryError('insert', [], cause);

  expect(isUniqueViolation(error, 'tags_name_unique')).toBe(true);
  expect(isUniqueViolation(error, 'places_google_place_id_unique')).toBe(false);
  expect(isUniqueViolation(new Error('connection failed'), 'tags_name_unique')).toBe(
    false,
  );
  expect(
    isUniqueViolation(
      {cause: {code: '23505', constraint: 'tags_name_unique'}},
      'tags_name_unique',
    ),
  ).toBe(false);

  cause.code = '23503';

  expect(isUniqueViolation(error, 'tags_name_unique')).toBe(false);
});
