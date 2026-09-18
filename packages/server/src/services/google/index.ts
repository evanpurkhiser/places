import {PlacesClient} from '@googlemaps/places';
import {z} from 'zod';

import {GoogleInputError, GoogleUnavailableError} from './errors.ts';
import {normalizeHours, openingHours} from './hours.ts';
import {featureIdToPlaceId, placeIdFromData} from './place-id.ts';

const placeId = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .min(1)
  .max(255);
const location = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
const details = z.object({
  id: placeId,
  displayName: z.object({text: z.string().trim().min(1)}),
  formattedAddress: z.string().trim().min(1),
  googleMapsUri: z.url(),
  location,
});

const metadataDetails = details.extend({
  timeZone: z
    .object({
      id: z
        .string()
        .min(1)
        .refine(value => {
          try {
            new Intl.DateTimeFormat('en', {timeZone: value});
            return true;
          } catch {
            return false;
          }
        }),
    })
    .optional(),
  businessStatus: z
    .enum(['OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY', 'FUTURE_OPENING'])
    .optional(),
  regularOpeningHours: openingHours.optional(),
});

function invalid(message: string): never {
  throw new GoogleInputError(message);
}

function mapsUrl(input: string): URL {
  const parsed = z.url().safeParse(input);

  if (!parsed.success) {
    return invalid('Use a Google Maps place link or gmaps:<place_id>.');
  }

  const url = new URL(parsed.data);
  const short =
    url.hostname === 'maps.app.goo.gl' ||
    (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/'));
  const maps =
    ['google.com', 'www.google.com', 'maps.google.com'].includes(url.hostname) &&
    (url.pathname.startsWith('/maps') || url.hostname === 'maps.google.com');

  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    (!short && !maps)
  ) {
    return invalid('Use an HTTPS Google Maps place link.');
  }

  return url;
}

export function isGoogleMapsInput(input: string): boolean {
  if (input.startsWith('gmaps:')) {
    return true;
  }

  try {
    mapsUrl(input);
    return true;
  } catch {
    return false;
  }
}

function parseId(input: string): string {
  const result = placeId.safeParse(input);

  if (!result.success) {
    return invalid('Invalid Google Place ID.');
  }

  return result.data;
}

export function createGooglePlaces(apiKey?: string, fetcher: typeof fetch = fetch) {
  const client = apiKey ? new PlacesClient({apiKey, fallback: true}) : undefined;

  async function followRedirect(url: URL) {
    try {
      return await fetcher(url.href, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new GoogleUnavailableError('Could not reach Google Maps. Try again.');
    }
  }

  async function resolve(input: string): Promise<string> {
    if (input.startsWith('gmaps:')) {
      return parseId(input.slice(6));
    }

    let url = mapsUrl(input);

    for (let redirects = 0; redirects <= 5; redirects++) {
      const explicit =
        url.searchParams.get('query_place_id') ??
        (url.searchParams.get('q')?.startsWith('place_id:')
          ? url.searchParams.get('q')!.slice(9)
          : null);

      if (explicit) {
        return parseId(explicit);
      }

      const data = url.pathname.split('/data=')[1] ?? url.searchParams.get('data');
      const feature = url.searchParams.get('ftid');
      const supported =
        url.pathname.startsWith('/maps/place/') ||
        url.pathname.startsWith('/maps/data=') ||
        url.pathname === '/maps';

      if (supported && ((data !== undefined && data !== null) || feature !== null)) {
        const id =
          feature !== null ? featureIdToPlaceId(feature) : placeIdFromData(data!);

        if (id) {
          return id;
        }

        return invalid('Invalid or ambiguous Google Maps place identifier.');
      }

      if (url.pathname.startsWith('/maps/place/')) {
        return invalid('This Maps link has no place identifier. Use gmaps:<place_id>.');
      }

      const response = await followRedirect(url);
      const next = response.headers.get('location');

      if (response.status < 300 || response.status >= 400 || !next) {
        return invalid('Could not resolve this Google Maps place link.');
      }

      // Check every hop before sending a request; never forward the API key to shared URLs.
      url = mapsUrl(new URL(next, url).href);
    }

    return invalid('Google Maps link redirected too many times.');
  }

  async function get(googlePlaceId: string) {
    const id = parseId(googlePlaceId);
    if (!client) {
      throw new GoogleUnavailableError('Configure google.apiKey to fetch place details.');
    }

    const [result] = await client
      .getPlace(
        {name: `places/${id}`},
        {
          timeout: 10000,
          retry: null,
          otherArgs: {
            headers: {
              'X-Goog-FieldMask':
                'id,displayName,formattedAddress,googleMapsUri,location',
            },
          },
        },
      )
      .catch(() => {
        // SDK errors can include request credentials and upstream response content.
        throw new GoogleUnavailableError('Google Places request failed. Try again.');
      });

    const parsed = details.safeParse(result);

    if (!parsed.success) {
      throw new GoogleUnavailableError(
        'Google Places returned invalid place details. Try again.',
      );
    }

    return parsed.data;
  }

  async function getMetadata(googlePlaceId: string) {
    const id = parseId(googlePlaceId);

    if (!apiKey) {
      throw new GoogleUnavailableError(
        'Configure google.apiKey to fetch place metadata.',
      );
    }

    // REST preserves absent versus empty periods; protobuf decoding conflates them.
    try {
      const response = await fetcher(`https://places.googleapis.com/v1/places/${id}`, {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'id,displayName,formattedAddress,googleMapsUri,location,timeZone,businessStatus,regularOpeningHours',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error('Place request failed.');
      }

      const result = metadataDetails.parse(await response.json());

      return {
        ...result,
        timeZone: result.timeZone?.id ?? null,
        businessStatus: result.businessStatus ?? null,
        hoursWeeklyOpen: normalizeHours(result.regularOpeningHours),
      };
    } catch {
      throw new GoogleUnavailableError(
        'Google Places metadata request failed. Try again.',
      );
    }
  }

  async function search(text: string) {
    if (!client) {
      throw new GoogleUnavailableError('Configure google.apiKey to search for places.');
    }

    const [result] = await client
      .searchText(
        {textQuery: text, maxResultCount: 1, includePureServiceAreaBusinesses: false},
        {
          timeout: 10000,
          retry: null,
          otherArgs: {
            headers: {
              'X-Goog-FieldMask':
                'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.location',
            },
          },
        },
      )
      .catch(() => {
        throw new GoogleUnavailableError('Google Places search failed. Try again.');
      });
    const parsed = z.array(details).safeParse(result.places ?? []);

    if (!parsed.success) {
      throw new GoogleUnavailableError(
        'Google Places returned invalid search results. Try again.',
      );
    }

    return parsed.data;
  }

  return {resolve, get, getMetadata, search};
}

export type GooglePlaces = ReturnType<typeof createGooglePlaces>;
