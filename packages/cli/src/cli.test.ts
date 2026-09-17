import {parse} from '@optique/core/parser';
import {describe, expect, it} from 'vitest';

import {parser} from './cli.ts';

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
