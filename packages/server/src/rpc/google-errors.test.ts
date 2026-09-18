import {ORPCError} from '@orpc/server';
import {expect, it} from 'vitest';

import {GoogleInputError, GoogleUnavailableError} from '../services/google/errors.ts';

import {rethrowGoogleError} from './google-errors.ts';

it.each([
  [new GoogleInputError('Invalid Google Place ID.'), 'BAD_REQUEST'],
  [new GoogleUnavailableError('Google Places request failed.'), 'SERVICE_UNAVAILABLE'],
])('maps Google errors to RPC responses: %s', (error, code) => {
  expect(() => rethrowGoogleError(error)).toThrow(ORPCError);
  expect(() => rethrowGoogleError(error)).toThrow(
    expect.objectContaining({code, message: error.message}),
  );
});

it('preserves errors from other sources', () => {
  const error = new Error('Unexpected failure');
  expect(() => rethrowGoogleError(error)).toThrow(error);
});
