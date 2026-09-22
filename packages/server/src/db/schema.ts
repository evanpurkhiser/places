import type {Source} from '@places/common/contract/source';
import type {TagIcon} from '@places/common/contract/tag';
import {inArray, sql} from 'drizzle-orm';
import {
  check,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  unique,
} from 'drizzle-orm/pg-core';

// PostGIS accepts EWKT on writes and returns hex EWKB. Convert to named
// latitude/longitude values in the API projection once the driver is selected.
const geographyPoint = customType<{data: string; driverData: string}>({
  dataType: () => 'geography(Point, 4326)',
});

// Recurring opening hours as [start, end) minute offsets in the place's local
// week: Sunday 00:00 = 0, the following Sunday 00:00 = 10080. Ranges are sorted
// and merged; periods crossing the week boundary are split at 0/10080.
// [[0, 10080]] means 24/7, [] means closed all week, and SQL NULL means unknown.
const weeklyHours = customType<{data: Array<[number, number]>; driverData: string}>({
  dataType: () => 'int4multirange',
  toDriver: ranges => `{${ranges.map(([start, end]) => `[${start},${end})`).join(',')}}`,
  fromDriver: value =>
    [...value.matchAll(/\[(\d+),(\d+)\)/g)].map(match => [
      Number(match[1]),
      Number(match[2]),
    ]),
});

const createdAt = () =>
  timestamp('created_at', {withTimezone: true}).defaultNow().notNull();

// $onUpdate applies to Drizzle writes. Direct SQL updates must set updated_at.
const updatedAt = () =>
  timestamp('updated_at', {withTimezone: true})
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

export const places = pgTable(
  'places',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    googlePlaceId: text('google_place_id').notNull().unique(),
    name: text('name').notNull(),
    formattedAddress: text('formatted_address').notNull(),
    googleMapsUrl: text('google_maps_url'),
    coordinates: geographyPoint('coordinates').notNull(),
    userNote: text('user_note'),
    // IANA zone used to map instants to the local weekly schedule.
    timeZone: text('time_zone'),
    hoursWeeklyOpen: weeklyHours('hours_weekly_open'),
    businessStatus: text('business_status'),
    lastSync: timestamp('last_sync', {withTimezone: true}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('places_coordinates_idx').using('gist', table.coordinates),
    index('places_hours_weekly_open_idx').using('gist', table.hoursWeeklyOpen),
    check(
      'places_hours_weekly_open_bounds',
      sql`${table.hoursWeeklyOpen} <@ '{[0,10080)}'::int4multirange`,
    ),
  ],
);

export const namespaces = pgTable(
  'namespaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull().unique(),
    icon: jsonb('icon').$type<TagIcon>(),
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    check(
      'namespaces_name_normalized',
      sql`${table.name} <> '' AND position('.' in ${table.name}) = 0 AND ${table.name} = lower(btrim(${table.name}))`,
    ),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull().unique(),
    archived: boolean('archived').default(false).notNull(),
    namespaceId: uuid('namespace_id').references(() => namespaces.id, {
      onDelete: 'restrict',
    }),
    icon: jsonb('icon').$type<TagIcon>(),
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('tags_namespace_id_idx').on(table.namespaceId),
    check(
      'tags_namespace_name',
      sql`(${table.namespaceId} IS NULL AND position('.' in ${table.name}) = 0) OR (${table.namespaceId} IS NOT NULL AND ${table.name} ~ '^[^.]+[.][^.]+$')`,
    ),
    check(
      'tags_name_normalized',
      sql`${table.name} <> '' AND ${table.name} = lower(btrim(${table.name})) AND split_part(${table.name}, '.', 1) = btrim(split_part(${table.name}, '.', 1)) AND split_part(${table.name}, '.', 2) = btrim(split_part(${table.name}, '.', 2))`,
    ),
  ],
);

export const placeTags = pgTable(
  'place_tags',
  {
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id, {onDelete: 'cascade'}),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, {onDelete: 'cascade'}),
    note: text('note'),
    createdAt: createdAt(),
  },
  table => [
    primaryKey({columns: [table.placeId, table.tagId]}),
    index('place_tags_tag_id_idx').on(table.tagId),
  ],
);

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    externalId: text('external_id'),
    url: text('url'),
    type: text('type').$type<Source['type']>().notNull(),
    description: text('description'),
    data: jsonb('data').$type<Source['data']>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [unique('sources_type_external_id_unique').on(table.type, table.externalId)],
);

export const placeSources = pgTable(
  'place_sources',
  {
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id, {onDelete: 'cascade'}),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, {onDelete: 'cascade'}),
    description: text('description'),
    data: jsonb('data'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    primaryKey({columns: [table.placeId, table.sourceId]}),
    index('place_sources_source_id_idx').on(table.sourceId),
  ],
);

const importRunTypes = ['instagram', 'gmaps'] as const;
const importRunStates = [
  'created',
  'active',
  'retry',
  'completed',
  'failed',
  'cancelled',
] as const;

/** Durable execution records, independent of the queue's retention period. */
export const importRuns = pgTable(
  'import_runs',
  {
    id: uuid('id').primaryKey(),
    type: text('type', {enum: importRunTypes}).notNull(),
    state: text('state', {enum: importRunStates}).notNull().default('created'),
    sourceId: uuid('source_id').references(() => sources.id, {onDelete: 'set null'}),
    input: jsonb('input').$type<unknown>().notNull(),
    output: jsonb('output').$type<unknown>(),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    startedAt: timestamp('started_at', {withTimezone: true}),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('import_runs_source_id_idx').on(table.sourceId),
    check('import_runs_type_check', inArray(table.type, importRunTypes).inlineParams()),
    check(
      'import_runs_state_check',
      inArray(table.state, importRunStates).inlineParams(),
    ),
  ],
);
