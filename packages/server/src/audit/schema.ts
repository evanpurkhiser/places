import {z} from 'zod';

export const auditSubject = z.strictObject({
  type: z.enum(['place', 'tag', 'namespace', 'source']),
  id: z.uuid(),
});

export const auditSystemId = z.enum(['gmaps-import', 'instagram-import', 'gmaps-sync']);

export const auditActor = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('user'), id: z.uuid()}),
  z.strictObject({type: z.literal('system'), id: auditSystemId}),
  z.strictObject({type: z.literal('unknown')}),
]);

const placeEntry = z.strictObject({
  subject: auditSubject.extend({type: z.literal('place')}),
  actor: auditActor,
});

export const auditEntry = z.discriminatedUnion('type', [
  placeEntry.extend({
    type: z.literal('place.created'),
    payload: z.strictObject({
      name: z.string(),
      userNote: z.string().nullable(),
      importRunId: z.uuid().optional(),
    }),
  }),
  placeEntry.extend({
    type: z.literal('place.deleted'),
    payload: z.strictObject({name: z.string()}),
  }),
]);

export type AuditEntry = z.infer<typeof auditEntry>;
