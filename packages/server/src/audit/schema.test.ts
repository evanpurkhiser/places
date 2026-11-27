import {expect, expectTypeOf, it} from 'vitest';

import type {saveAuditEntry} from './index.ts';
import {auditEntry} from './schema.ts';

const deleted = {
  type: 'place.deleted',
  subject: {type: 'place', id: '00000000-0000-4000-8000-000000000001'},
  actor: {type: 'unknown'},
  payload: {name: 'Test Cafe'},
} as const;

it('correlates the writer payload type with the event type', () => {
  type Entry = Parameters<typeof saveAuditEntry>[1];
  expectTypeOf<Extract<Entry, {type: 'place.created'}>['payload']>().toEqualTypeOf<{
    name: string;
    userNote: string | null;
    importRunId?: string | undefined;
  }>();
  expectTypeOf<Extract<Entry, {type: 'place.deleted'}>['payload']>().toEqualTypeOf<{
    name: string;
  }>();
});

it('validates the subject, actor, and payload against the event type', () => {
  expect(auditEntry.parse(deleted)).toEqual(deleted);
  expect(auditEntry.safeParse({...deleted, type: 'place.created'}).success).toBe(false);
  expect(
    auditEntry.safeParse({...deleted, subject: {...deleted.subject, type: 'tag'}})
      .success,
  ).toBe(false);
  expect(
    auditEntry.safeParse({...deleted, actor: {type: 'system', id: 'unregistered'}})
      .success,
  ).toBe(false);
});
