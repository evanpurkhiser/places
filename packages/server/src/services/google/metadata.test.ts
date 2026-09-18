import {describe, expect, it, vi} from 'vitest';

import {createGooglePlaces} from './index.ts';

const details = {
  id: 'test',
  displayName: {text: 'Cafe'},
  formattedAddress: 'NYC',
  googleMapsUri: 'https://maps.google.com/',
  location: {latitude: 40, longitude: -74},
};

describe('Google place metadata', () => {
  it('preserves missing versus empty hours through REST and validates time zones', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({...details, timeZone: {id: 'Asia/Saigon'}}))
      .mockResolvedValueOnce(
        Response.json({...details, regularOpeningHours: {periods: []}}),
      );
    const google = createGooglePlaces('secret', fetcher);
    expect(await google.getMetadata('test')).toMatchObject({
      timeZone: 'Asia/Saigon',
      hoursWeeklyOpen: null,
    });
    expect(await google.getMetadata('test')).toMatchObject({
      timeZone: null,
      hoursWeeklyOpen: [],
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://places.googleapis.com/v1/places/test',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({
          'X-Goog-FieldMask': expect.stringContaining('regularOpeningHours'),
        }),
      }),
    );
  });

  it('accepts a refreshed Google ID from a successful details response', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({...details, id: 'replacement'}));
    expect(await createGooglePlaces('secret', fetcher).getMetadata('test')).toMatchObject(
      {
        id: 'replacement',
      },
    );
  });

  it.each([
    {...details, timeZone: {id: 'invalid/zone'}},
    {...details, regularOpeningHours: {periods: [{open: {day: 2, hour: 9, minute: 0}}]}},
  ])('rejects invalid refreshes without exposing the response', async body => {
    const google = createGooglePlaces(
      'secret',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)),
    );
    await expect(google.getMetadata('test')).rejects.toThrow(
      'Google Places metadata request failed. Try again.',
    );
  });

  it('sanitizes HTTP and network failures and rejects missing configuration', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('secret', {status: 403}))
      .mockRejectedValueOnce(new Error('secret'));
    const google = createGooglePlaces('secret', fetcher);
    await expect(google.getMetadata('test')).rejects.toThrow(
      'Google Places metadata request failed. Try again.',
    );
    await expect(google.getMetadata('test')).rejects.toThrow(
      'Google Places metadata request failed. Try again.',
    );
    await expect(createGooglePlaces().getMetadata('test')).rejects.toThrow(
      'Configure google.apiKey',
    );
  });
});
