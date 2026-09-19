import {DrizzleQueryError} from 'drizzle-orm';
import {DatabaseError} from 'pg';

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    error instanceof DrizzleQueryError &&
    error.cause instanceof DatabaseError &&
    error.cause.code === '23505' &&
    error.cause.constraint === constraint
  );
}

export function isForeignKeyViolation(error: unknown, constraint: string): boolean {
  return (
    error instanceof DrizzleQueryError &&
    error.cause instanceof DatabaseError &&
    error.cause.code === '23503' &&
    error.cause.constraint === constraint
  );
}
