import {parse} from '@optique/core/parser';
import type {Client} from '@places/common/contract';
import {describe, expect, it, vi} from 'vitest';

import {execute, parser} from './cli.ts';

describe('tag arguments', () => {
  it('normalizes names using the shared schema', () => {
    expect(parse(parser, ['tags', 'create', ' CAFE '])).toMatchObject({
      success: true,
      value: {action: 'create', name: 'cafe'},
    });
  });

  it('accepts a server override before or after the subcommand', () => {
    for (const args of [
      ['--server', 'https://5188.prk.network', 'tags', 'list'],
      ['tags', 'list', '--server', 'https://5188.prk.network'],
    ]) {
      expect(parse(parser, args)).toMatchObject({
        success: true,
        value: {action: 'list', server: 'https://5188.prk.network'},
      });
    }
  });

  it('accepts a config path before or after the subcommand', () => {
    for (const args of [
      ['--config', '/tmp/places.yaml', 'tags', 'list'],
      ['tags', 'list', '--config', '/tmp/places.yaml'],
    ]) {
      expect(parse(parser, args)).toMatchObject({
        success: true,
        value: {action: 'list', config: '/tmp/places.yaml'},
      });
    }
  });

  it.each([
    ['tags', 'create', '  '],
    ['tags', 'create', ':cafe'],
    ['tags', 'update', '9a53fa46-9d9d-4dac-b0b2-f3a8334900ef', 'type:'],
    ['tags', 'create'],
    ['tags', 'get', 'bad-id'],
    ['tags', 'list', '--unknown'],
    ['tags', 'list', 'extra'],
    ['tags', 'update', 'bad-id', 'cafe'],
    ['--server', 'file:///tmp/places', 'tags', 'list'],
  ])('rejects invalid arguments: %j', (...args) => {
    expect(parse(parser, args)).toMatchObject({success: false});
  });
});

describe('import arguments', () => {
  it.each([undefined, '', '  Try the espresso tonic.\nAsk for oat milk.  '])(
    'forwards notes verbatim: %j',
    notes => {
      const result = parse(parser, [
        'import',
        'gmaps:ChIJtest',
        ...(notes === undefined ? [] : ['--notes', notes]),
      ]);

      if (!result.success) {
        throw new Error('Expected valid arguments');
      }

      const places = {import: vi.fn()};
      execute(result.value, {places} as unknown as Client);

      expect(places.import).toHaveBeenCalledWith({
        input: 'gmaps:ChIJtest',
        tags: [],
        notes,
      });
    },
  );

  it('requires a value for notes', () => {
    expect(parse(parser, ['import', 'gmaps:ChIJtest', '--notes'])).toMatchObject({
      success: false,
    });
  });

  it('accepts repeated tags by name and ID around the input', () => {
    const id = '9a53fa46-9d9d-4dac-b0b2-f3a8334900ef';

    expect(
      parse(parser, ['import', '--tag', ' Type:CAFE ', 'gmaps:ChIJtest', '--tag', id]),
    ).toMatchObject({
      success: true,
      value: {action: 'import', input: 'gmaps:ChIJtest', tags: ['type:cafe', id]},
    });
  });

  it.each(['Code 1234', '', '  Case Preserved\nSecond line  ', 'gmaps:note'])(
    'keeps repeated tag notes paired around the input: %j',
    note => {
      const result = parse(parser, [
        'import',
        '--tag-note',
        ' Attr:Nice-Bathroom ',
        note,
        '--tag',
        'type:cafe',
        'gmaps:ChIJtest',
        '--tag-note',
        'favorite',
        'Order the Espresso',
        '--notes',
        'Place note',
      ]);

      expect(result).toMatchObject({success: true});

      if (!result.success) {
        throw new Error('Expected valid arguments');
      }

      const places = {import: vi.fn()};
      execute(result.value, {places} as unknown as Client);

      expect(places.import).toHaveBeenCalledWith({
        input: 'gmaps:ChIJtest',
        notes: 'Place note',
        tags: [
          {tag: 'type:cafe'},
          {tag: 'attr:nice-bathroom', note},
          {tag: 'favorite', note: 'Order the Espresso'},
        ],
      });
    },
  );

  it.each([
    ['import', 'gmaps:ChIJtest', '--tag-note'],
    ['import', 'gmaps:ChIJtest', '--tag-note', 'favorite'],
    ['import', 'gmaps:ChIJtest', '--tag-note', 'favorite', '--tag', 'type:cafe'],
    ['import', '--tag-note', 'favorite', 'Note'],
    ['import', 'gmaps:ChIJtest', '--tag-note', ' ', 'Note'],
    ['import', 'gmaps:ChIJtest', 'Stray note'],
  ])('rejects incomplete or invalid tag-note arguments: %j', (...args) => {
    expect(parse(parser, args)).toMatchObject({success: false});
  });

  it('defaults to no tags', () => {
    expect(parse(parser, ['import', 'gmaps:ChIJtest'])).toMatchObject({
      success: true,
      value: {tags: []},
    });
  });

  it.each([
    ['import', 'gmaps:ChIJtest', '--tag'],
    ['import', 'gmaps:ChIJtest', '--tag', '  '],
  ])('rejects invalid tag arguments: %j', (...args) => {
    expect(parse(parser, args)).toMatchObject({success: false});
  });
});

describe('tag metadata', () => {
  const id = '9a53fa46-9d9d-4dac-b0b2-f3a8334900ef';

  function setup(args: string[]) {
    const result = parse(parser, ['tags', ...args]);

    if (!result.success) {
      throw new Error('Expected valid arguments');
    }

    const tags = {create: vi.fn(), update: vi.fn()};
    const client = {tags} as unknown as Client;

    return {tags, run: () => execute(result.value, client)};
  }

  it('creates tags with normalized emoji and verbatim descriptions', () => {
    const {tags, run} = setup([
      'create',
      ' CAFE ',
      '--icon',
      ' ☕ ',
      '--description',
      'Cafe or coffee shop.',
    ]);
    run();

    expect(tags.create).toHaveBeenCalledWith({
      name: 'cafe',
      icon: {emoji: '☕'},
      description: 'Cafe or coffee shop.',
    });
  });

  it('updates metadata without renaming the tag', () => {
    const {tags, run} = setup(['update', id, '--icon', '☕', '--description', 'Coffee.']);
    run();

    expect(tags.update).toHaveBeenCalledWith({
      id,
      name: undefined,
      icon: {emoji: '☕'},
      description: 'Coffee.',
    });
  });

  it('preserves omitted metadata when renaming', () => {
    const {tags, run} = setup(['update', id, ' Coffee ']);
    run();

    expect(tags.update).toHaveBeenCalledWith({
      id,
      name: 'coffee',
      icon: undefined,
      description: undefined,
    });
  });

  it.each([
    [['--icon', ''], {icon: null, description: undefined}],
    [['--description', ''], {icon: undefined, description: null}],
    [['--icon', '', '--description', ''], {icon: null, description: null}],
  ])('clears fields with empty strings: %j', (options, metadata) => {
    const {tags, run} = setup(['update', id, ...options]);
    run();

    expect(tags.update).toHaveBeenCalledWith({id, name: undefined, ...metadata});
  });

  it('creates tags with null metadata for empty strings', () => {
    const {tags, run} = setup(['create', 'cafe', '--icon', '', '--description', '']);
    run();

    expect(tags.create).toHaveBeenCalledWith({
      name: 'cafe',
      icon: null,
      description: null,
    });
  });

  it('rejects empty updates before calling the server', () => {
    const {tags, run} = setup(['update', id]);

    expect(run).toThrow('Provide a name, --icon, or --description.');
    expect(tags.update).not.toHaveBeenCalled();
  });

  it.each([
    ['create', 'cafe', '--icon', '  '],
    ['create', 'cafe', '--icon'],
    ['update', id, '--icon', '  '],
    ['update', id, '--description'],
  ])('rejects invalid metadata arguments: %j', (...args) => {
    expect(parse(parser, ['tags', ...args])).toMatchObject({success: false});
  });
});

describe('place tagging arguments', () => {
  const placeId = '9a53fa46-9d9d-4dac-b0b2-f3a8334900ef';

  it.each([undefined, '', '  Code 1234\nDownstairs  '])(
    'forwards assignment notes: %j',
    notes => {
      const result = parse(parser, [
        'tag',
        placeId,
        ' Attr:Nice-Bathroom ',
        ...(notes === undefined ? [] : ['--notes', notes]),
      ]);

      if (!result.success) {
        throw new Error('Expected valid arguments');
      }

      const places = {tag: vi.fn()};
      execute(result.value, {places} as unknown as Client);
      expect(places.tag).toHaveBeenCalledWith({
        placeId,
        tag: 'attr:nice-bathroom',
        notes,
      });
    },
  );

  it('forwards untag by UUID', () => {
    const result = parse(parser, ['untag', placeId, placeId]);

    if (!result.success) {
      throw new Error('Expected valid arguments');
    }

    const places = {untag: vi.fn()};
    execute(result.value, {places} as unknown as Client);
    expect(places.untag).toHaveBeenCalledWith({placeId, tag: placeId});
  });

  it.each([
    ['tag', 'bad-id', 'favorite'],
    ['tag', placeId],
    ['tag', placeId, ' '],
    ['tag', placeId, 'favorite', '--notes'],
    ['untag', placeId],
    ['untag', placeId, 'favorite', '--notes', 'Note'],
  ])('rejects invalid assignment arguments: %j', (...args) => {
    expect(parse(parser, args)).toMatchObject({success: false});
  });
});

describe('place query arguments', () => {
  it.each([undefined, '', '  tag[type:cafe] OR notes["Good Coffee"]\n'])(
    'forwards the query without normalization: %j',
    query => {
      const result = parse(parser, [
        'list',
        ...(query === undefined ? [] : ['--query', query]),
      ]);

      if (!result.success) {
        throw new Error('Expected valid arguments');
      }

      const places = {list: vi.fn()};
      execute(result.value, {places} as unknown as Client);

      if (query === undefined) {
        expect(places.list).toHaveBeenCalledWith();
      } else {
        expect(places.list).toHaveBeenCalledWith({query});
      }
    },
  );

  it('requires a query value', () => {
    expect(parse(parser, ['list', '--query'])).toMatchObject({success: false});
  });
});

describe('query documentation', () => {
  it('fetches documentation from the server', async () => {
    const result = parse(parser, ['docs', 'filter']);

    if (!result.success) {
      throw new Error('Expected valid arguments');
    }

    const documentation = {filters: [], functions: [], types: []};
    const describe = vi.fn().mockResolvedValue(documentation);
    const client = {query: {describe}} as unknown as Client;
    expect(await execute(result.value, client)).toContain('Filter language\n');
    expect(describe).toHaveBeenCalledExactlyOnceWith();
  });
});

describe('Google Maps search', () => {
  it('searches by keyword and returns importable results', async () => {
    const result = parse(parser, ['search-gmaps', ' coffee shops in NYC ']);

    if (!result.success) {
      throw new Error('Expected valid arguments');
    }

    const matches = [{input: 'gmaps:ChIJtest', name: 'Test Cafe'}];
    const searchGoogle = vi.fn().mockResolvedValue(matches);
    const client = {places: {searchGoogle}} as unknown as Client;

    expect(await execute(result.value, client)).toEqual(matches);
    expect(searchGoogle).toHaveBeenCalledExactlyOnceWith({query: 'coffee shops in NYC'});
  });

  it.each([['search-gmaps'], ['search-gmaps', '  ']])(
    'rejects missing or blank queries: %j',
    (...args) => {
      expect(parse(parser, args)).toMatchObject({success: false});
    },
  );
});

describe('place sync commands', () => {
  it('queues all places or forwards a filter query', async () => {
    const sync = vi
      .fn()
      .mockResolvedValue({matched: 0, queued: 0, alreadyQueued: 0, jobIds: []});
    const client = {places: {sync}} as unknown as Client;

    for (const args of [['sync'], ['sync', '--query', 'tag[favorite]']]) {
      const result = parse(parser, args);
      expect(result.success).toBe(true);

      if (result.success) {
        await execute(result.value, client);
      }
    }

    expect(sync.mock.calls).toEqual([[{query: undefined}], [{query: 'tag[favorite]'}]]);
  });

  it('parses sync status and rejects invalid job IDs', () => {
    expect(
      parse(parser, ['sync-status', '00000000-0000-4000-8000-000000000001']),
    ).toMatchObject({success: true, value: {action: 'sync-status'}});
    expect(parse(parser, ['sync-status', 'invalid'])).toMatchObject({success: false});
  });
});

describe.each(['namespace', 'ns'])('%s commands', command => {
  const id = '9a53fa46-9d9d-4dac-b0b2-f3a8334900ef';

  function setup(args: string[]) {
    const result = parse(parser, [command, ...args]);

    if (!result.success) {
      throw new Error('Expected valid arguments');
    }

    const tags = {
      create: vi.fn(),
      update: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    };
    const client = {namespaces: tags} as unknown as Client;

    return {tags, run: () => execute(result.value, client)};
  }

  it('creates tags with normalized emoji and verbatim descriptions', () => {
    const {tags, run} = setup([
      'create',
      ' TYPE ',
      '--icon',
      ' ☕ ',
      '--description',
      'Cafe or coffee shop.',
    ]);
    run();

    expect(tags.create).toHaveBeenCalledWith({
      name: 'type',
      icon: {emoji: '☕'},
      description: 'Cafe or coffee shop.',
    });
  });

  it('updates metadata without renaming the tag', () => {
    const {tags, run} = setup(['update', id, '--icon', '☕', '--description', 'Coffee.']);
    run();

    expect(tags.update).toHaveBeenCalledWith({
      id,
      name: undefined,
      icon: {emoji: '☕'},
      description: 'Coffee.',
    });
  });

  it('preserves omitted metadata when renaming', () => {
    const {tags, run} = setup(['update', id, ' CATEGORY ']);
    run();

    expect(tags.update).toHaveBeenCalledWith({
      id,
      name: 'category',
      icon: undefined,
      description: undefined,
    });
  });

  it.each([
    [['--icon', ''], {icon: null, description: undefined}],
    [['--description', ''], {icon: undefined, description: null}],
    [['--icon', '', '--description', ''], {icon: null, description: null}],
  ])('clears fields with empty strings: %j', (options, metadata) => {
    const {tags, run} = setup(['update', id, ...options]);
    run();

    expect(tags.update).toHaveBeenCalledWith({id, name: undefined, ...metadata});
  });

  it('creates tags with null metadata for empty strings', () => {
    const {tags, run} = setup(['create', 'type', '--icon', '', '--description', '']);
    run();

    expect(tags.create).toHaveBeenCalledWith({
      name: 'type',
      icon: null,
      description: null,
    });
  });

  it('rejects empty updates before calling the server', () => {
    const {tags, run} = setup(['update', id]);

    expect(run).toThrow('Provide a name, --icon, or --description.');
    expect(tags.update).not.toHaveBeenCalled();
  });

  it.each([
    ['create', 'type', '--icon', '  '],
    ['create', 'type', '--icon'],
    ['update', id, '--icon', '  '],
    ['update', id, '--description'],
  ])('rejects invalid metadata arguments: %j', (...args) => {
    expect(parse(parser, [command, ...args])).toMatchObject({success: false});
  });
  it.each(['list', 'get', 'delete'] as const)('dispatches %s', action => {
    const {tags, run} = setup([action, ...(action === 'list' ? [] : [id])]);
    run();
    expect(tags[action].mock.calls).toEqual(
      action === 'list' ? [[]] : [[action === 'delete' ? {id, force: false} : {id}]],
    );
  });

  it.each([
    ['delete', id, '--force'],
    ['delete', '--force', id],
  ])('forwards force deletion: %j', (...args) => {
    const {tags, run} = setup(args);
    run();
    expect(tags.delete).toHaveBeenCalledWith({id, force: true});
  });

  it.each([
    ['create', 'type:cafe'],
    ['update', id, 'type:cafe'],
    ['get', 'bad-id'],
  ])('rejects invalid arguments: %j', (...args) => {
    expect(parse(parser, [command, ...args])).toMatchObject({success: false});
  });
});

describe('qualified tag commands', () => {
  it('passes qualified names to creation and renaming', () => {
    const tags = {create: vi.fn(), update: vi.fn()};
    const client = {tags} as unknown as Client;
    const id = '9a53fa46-9d9d-4dac-b0b2-f3a8334900ef';

    for (const args of [
      ['create', ' TYPE:CAFE '],
      ['update', id, ' Cuisine:Coffee '],
    ]) {
      const result = parse(parser, ['tags', ...args]);
      expect(result.success).toBe(true);

      if (result.success) {
        execute(result.value, client);
      }
    }

    expect(tags.create).toHaveBeenCalledWith({
      name: 'type:cafe',
      icon: undefined,
      description: undefined,
    });
    expect(tags.update).toHaveBeenCalledWith({
      id,
      name: 'cuisine:coffee',
      icon: undefined,
      description: undefined,
    });
  });
});
