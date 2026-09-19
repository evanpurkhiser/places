import {DrizzleQueryError} from 'drizzle-orm';
import {DatabaseError} from 'pg';
import {expect, it} from 'vitest';

import {isForeignKeyViolation, isUniqueViolation} from './errors.ts';

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

it('matches only the requested foreign key constraint', () => {
  const cause = new DatabaseError('foreign key violation', 0, 'error');
  cause.code = '23503';
  cause.constraint = 'tags_namespace_id_namespaces_id_fk';
  const error = new DrizzleQueryError('delete', [], cause);

  expect(isForeignKeyViolation(error, cause.constraint)).toBe(true);
  expect(isForeignKeyViolation(error, 'other_fk')).toBe(false);
  expect(isForeignKeyViolation(new Error('connection failed'), cause.constraint)).toBe(
    false,
  );
  cause.code = '23505';
  expect(isForeignKeyViolation(error, cause.constraint)).toBe(false);
});
