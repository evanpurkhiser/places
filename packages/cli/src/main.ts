import {run} from '@optique/run';

import {createClient, execute, parser} from './cli.ts';

const args = run(parser, {programName: 'places', help: 'option'});

try {
  const result = await execute(args, createClient(args.server));

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Request failed');
  process.exitCode = 1;
}
