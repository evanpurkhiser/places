import type {Operator, StringValue} from '@places/common/search';
import {sql, type SQL, type SQLWrapper} from 'drizzle-orm';

/**
 * Convert only grammar wildcard positions; PostgreSQL pattern syntax stays literal.
 */
export function likePattern(value: StringValue, substring: boolean): string {
  const wildcards = new Set(value.wildcards);
  const pattern = value.value
    .split('')
    .map((character, index) => {
      if (wildcards.has(index)) {
        return '%';
      }

      return /[%_\\]/.test(character) ? `\\${character}` : character;
    })
    .join('');

  return substring ? `%${pattern}%` : pattern;
}

export function present(column: SQLWrapper): SQL {
  return sql`(${column} is not null and ${column} <> '')`;
}

export function matchText(
  column: SQLWrapper,
  value: StringValue,
  operator: Operator | null,
  substring = true,
): SQL {
  const comparison = operator
    ? sql`lower(${column}) = lower(${value.value})`
    : sql`${column} ilike ${likePattern(value, substring)} escape '\\'`;
  // Explicit presence makes each predicate two-valued, including under negation.
  return sql`(${present(column)} and ${comparison})`;
}
