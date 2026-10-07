import type {Point} from '@places/common/filter-engine/values/geographic-point';
import {sql, type SQL} from 'drizzle-orm';

export function geographyPoint({longitude, latitude}: Point): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`;
}
