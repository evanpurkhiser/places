import {parse} from '@optique/core/parser';
import type {Client} from '@places/common/contract';
import {describe, expect, it, vi} from 'vitest';

import {execute, parser} from './cli.ts';

describe('tag arguments', () => {
  it('normalizes names using the shared schema', () => {
    expect(parse(parser, ['tags', 'create', ' Type:CAFE '])).toMatchObject({
      success: true,
      value: {action: 'create', name: 'type:cafe'},
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

  it.each([
    ['tags', 'create', '  '],
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

describe('import tag arguments', () => {
  it('accepts repeated tags by name and ID around the input', () => {
    const id = '9a53fa46-9d9d-4dac-b0b2-f3a8334900ef';

    expect(
      parse(parser, ['import', '--tag', ' Type:CAFE ', 'gmaps:ChIJtest', '--tag', id]),
    ).toMatchObject({
      success: true,
      value: {action: 'import', input: 'gmaps:ChIJtest', tags: ['type:cafe', id]},
    });
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
      ' Type:CAFE ',
      '--icon',
      ' ☕ ',
      '--description',
      'Cafe or coffee shop.',
    ]);
    run();

    expect(tags.create).toHaveBeenCalledWith({
      name: 'type:cafe',
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
    const {tags, run} = setup(['update', id, ' Type:Coffee ']);
    run();

    expect(tags.update).toHaveBeenCalledWith({
      id,
      name: 'type:coffee',
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
    const {tags, run} = setup(['create', 'type:cafe', '--icon', '', '--description', '']);
    run();

    expect(tags.create).toHaveBeenCalledWith({
      name: 'type:cafe',
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
    ['create', 'type:cafe', '--icon', '  '],
    ['create', 'type:cafe', '--icon'],
    ['update', id, '--icon', '  '],
    ['update', id, '--description'],
  ])('rejects invalid metadata arguments: %j', (...args) => {
    expect(parse(parser, ['tags', ...args])).toMatchObject({success: false});
  });
});
