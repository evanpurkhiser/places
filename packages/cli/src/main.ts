#!/usr/bin/env node

import {message} from '@optique/core/message';
import {run} from '@optique/run';
import {ORPCError} from '@orpc/client';
import {queryErrorData} from '@places/common/contract/place';

import packageInfo from '../package.json' with {type: 'json'};

import {createClient, execute, parser} from './cli.ts';
import {loadConfig} from './config.ts';

const args = run(parser, {
  programName: 'places',
  help: 'option',
  version: packageInfo.version,
  brief: message`A personal, tag-based place mapping tool.`,
  description: message`Manage saved places through the Places server. Data commands print JSON; docs commands print text. Failures print to stderr and exit nonzero.`,
  footer: message`Get started: places tags create 'cafe', then places tags list. Use places tags --help to browse commands.`,
});

try {
  const config = await loadConfig(args);
  const result = await execute(args, createClient(config.server));

  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
} catch (error) {
  const queryError =
    error instanceof ORPCError && error.code === 'BAD_REQUEST'
      ? queryErrorData.safeParse(error.data)
      : undefined;

  console.error(
    error instanceof ORPCError && queryError?.success
      ? JSON.stringify({message: error.message, ...queryError.data}, null, 2)
      : error instanceof Error
        ? error.message
        : 'Request failed',
  );
  process.exitCode = 1;
}
