import {ORPCError} from '@orpc/server';

import {
  ImportNotFoundError,
  ImportUnavailableError,
  InvalidImportInputError,
} from '../importers/errors.ts';
import {GoogleInputError, GoogleUnavailableError} from '../services/google/errors.ts';

export function rethrowImportError(error: unknown): never {
  if (error instanceof InvalidImportInputError || error instanceof GoogleInputError) {
    throw new ORPCError('BAD_REQUEST', {message: error.message});
  }

  if (error instanceof ImportNotFoundError) {
    throw new ORPCError('NOT_FOUND', {message: error.message});
  }

  if (
    error instanceof ImportUnavailableError ||
    error instanceof GoogleUnavailableError
  ) {
    throw new ORPCError('SERVICE_UNAVAILABLE', {message: error.message});
  }

  throw error;
}
