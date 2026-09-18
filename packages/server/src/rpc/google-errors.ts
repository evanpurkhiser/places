import {ORPCError} from '@orpc/server';

import {GoogleInputError, GoogleUnavailableError} from '../services/google/errors.ts';

export function rethrowGoogleError(error: unknown): never {
  if (error instanceof GoogleInputError) {
    throw new ORPCError('BAD_REQUEST', {message: error.message});
  }

  if (error instanceof GoogleUnavailableError) {
    throw new ORPCError('SERVICE_UNAVAILABLE', {message: error.message});
  }

  throw error;
}
