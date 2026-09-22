import {defineFilterEngine} from './definitions.ts';
import {has} from './filters/has.ts';
import {location} from './filters/location.ts';
import {open} from './filters/open.ts';
import {source} from './filters/source.ts';
import {tag} from './filters/tag.ts';
import {address, name, notes} from './filters/text.ts';
import {point} from './functions/point.ts';
import {radius} from './functions/radius.ts';
import {rect} from './functions/rect.ts';
import {sector} from './functions/sector.ts';
import {degrees} from './values/degrees.ts';
import {distance} from './values/distance.ts';
import {duration} from './values/duration.ts';
import {geographicPoint} from './values/geographic-point.ts';
import {geographicPredicate} from './values/geographic-predicate.ts';
import {latitude} from './values/latitude.ts';
import {longitude} from './values/longitude.ts';
import {property} from './values/property.ts';
import {tagName} from './values/tag-name.ts';
import {textLiteral} from './values/text-literal.ts';
import {text} from './values/text.ts';
import {time} from './values/time.ts';
import {uuid} from './values/uuid.ts';

/**
 * Complete shared definition of the Places query language.
 *
 * Browser and server hosts consume the same value, filter, and function
 * catalog. The server overlays resolvers and SQL compilers with
 * `implementFilterEngine`; browser clients can inspect these definitions to
 * build structured search and autocomplete interfaces.
 */
export const placeFilterEngineDefinition = defineFilterEngine({
  values: {
    text,
    uuid,
    textLiteral,
    tagName,
    property,
    distance,
    duration,
    time,
    degrees,
    longitude,
    latitude,
    geographicPoint,
    geographicPredicate,
  },
  filters: {tag, source, name, address, notes, has, location, open},
  functions: {point, radius, rect, sector},
});
