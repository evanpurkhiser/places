import {beforeEach, describe, expect, it, vi} from 'vitest';

import {createGooglePlaces} from './index.ts';

const sdk = vi.hoisted(() => ({
  searchText: vi.fn(),
  getPlace: vi.fn(),
}));

vi.mock('@googlemaps/places', () => ({
  PlacesClient: class {
    searchText = sdk.searchText;
    getPlace = sdk.getPlace;
  },
}));

beforeEach(() => vi.resetAllMocks());

const mapUrl =
  'https://www.google.com/maps/place/Carnitas+Ramirez/@40.722,-73.984,17z/data=!4m2!3m1!1s0x89c2590050d251e3:0xd0a2838a932ab585';
const candidate = {
  id: 'ChIJtest',
  displayName: {text: 'Carnitas Ramirez'},
  location: {latitude: 40.7224688, longitude: -73.9827999},
};

describe('Google Places', () => {
  it('accepts explicit IDs without making network requests', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const google = createGooglePlaces(undefined, fetcher);

    expect(await google.resolve('gmaps:ChIJtest')).toBe('ChIJtest');
    expect(
      await google.resolve(
        'https://www.google.com/maps/search/?api=1&query=cafe&query_place_id=ChIJtest',
      ),
    ).toBe('ChIJtest');
    expect(await google.resolve('https://maps.google.com/?q=place_id:ChIJtest')).toBe(
      'ChIJtest',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(sdk.searchText).not.toHaveBeenCalled();
    expect(sdk.getPlace).not.toHaveBeenCalled();
  });

  it('expands a short link and decodes its identifier without an API call', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {status: 302, headers: {location: mapUrl}}),
      );
    const google = createGooglePlaces(undefined, fetcher);

    expect(await google.resolve('https://maps.app.goo.gl/example')).toBe(
      'ChIJ41HSUABZwokRhbUqk4qDotA',
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({method: 'HEAD', redirect: 'manual'});
    expect(fetcher.mock.calls[0]![1]?.headers).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sdk.searchText).not.toHaveBeenCalled();
    expect(sdk.getPlace).not.toHaveBeenCalled();
  });

  it.each([
    mapUrl,
    'https://www.google.com/maps/place/Anything/data=!4m2!3m1!1s0x89c2590050d251e3%3A0xd0a2838a932ab585',
    'https://www.google.com/maps?ftid=0x89c2590050d251e3%3A0xd0a2838a932ab585',
    'https://www.google.com/maps/place/Anything/data=!19sChIJ41HSUABZwokRhbUqk4qDotA',
  ])('resolves embedded identifiers locally: %s', async input => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await createGooglePlaces(undefined, fetcher).resolve(input)).toBe(
      'ChIJ41HSUABZwokRhbUqk4qDotA',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(sdk.searchText).not.toHaveBeenCalled();
    expect(sdk.getPlace).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1/maps',
    'https://google.com.evil.test/maps',
    'https://user:password@www.google.com/maps',
    'https://www.google.com:444/maps',
    'https://www.google.com/maps/place/Royale/data=!3d40.7258034!4d-73.9778674',
    'https://www.google.com/maps/place/Royale/data=!1s0x1:0x2junk',
    'https://www.google.com/maps/place/Royale/data=!1s0x1:0x2!1s0x3:0x4',
    'gmaps:',
    'gmaps:bad/id',
    'https://www.google.com/maps/place/Somewhere/@40,-73,17z',
  ])('rejects unsupported inputs without a fetch: %s', async input => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      createGooglePlaces('test-key', fetcher).resolve(input),
    ).rejects.toMatchObject({code: 'BAD_REQUEST'});
    expect(fetcher).not.toHaveBeenCalled();
    expect(sdk.searchText).not.toHaveBeenCalled();
    expect(sdk.getPlace).not.toHaveBeenCalled();
  });

  it('rejects unsafe redirect targets before requesting them', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {location: 'http://127.0.0.1/private'},
      }),
    );

    await expect(
      createGooglePlaces('test-key', fetcher).resolve('https://maps.app.goo.gl/example'),
    ).rejects.toMatchObject({code: 'BAD_REQUEST'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('bounds redirect loops', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: {location: 'https://maps.app.goo.gl/loop'},
        }),
      ),
    );

    await expect(
      createGooglePlaces('test-key', fetcher).resolve('https://maps.app.goo.gl/loop'),
    ).rejects.toMatchObject({code: 'BAD_REQUEST'});
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('requests only the required metadata and rejects incomplete details', async () => {
    const payload = {
      ...candidate,
      formattedAddress: 'New York, NY',
      googleMapsUri: mapUrl,
    };
    sdk.getPlace.mockResolvedValueOnce([payload]).mockResolvedValueOnce([candidate]);
    const google = createGooglePlaces('test-key');

    expect(await google.get('ChIJtest')).toEqual(payload);
    expect(sdk.getPlace).toHaveBeenCalledWith(
      {name: 'places/ChIJtest'},
      {
        timeout: 10000,
        retry: null,
        otherArgs: {
          headers: {
            'X-Goog-FieldMask': 'id,displayName,formattedAddress,googleMapsUri,location',
          },
        },
      },
    );
    await expect(google.get('ChIJtest')).rejects.toThrow();
  });

  it('reports short-link network failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('network failure'));

    await expect(
      createGooglePlaces('test-key', fetcher).resolve('https://maps.app.goo.gl/example'),
    ).rejects.toMatchObject({code: 'SERVICE_UNAVAILABLE'});
    expect(sdk.searchText).not.toHaveBeenCalled();
  });

  it('reports missing configuration and upstream failures without exposing response content', async () => {
    await expect(createGooglePlaces().get('ChIJtest')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(sdk.getPlace).not.toHaveBeenCalled();
    sdk.getPlace.mockRejectedValue(new Error('sensitive body with test-key'));
    const google = createGooglePlaces('test-key');

    await expect(google.get('ChIJtest')).rejects.toMatchObject({
      message: 'Google Places request failed. Try again.',
    });
  });
});
