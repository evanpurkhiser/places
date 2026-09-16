import {message} from '@optique/core/message';
import {run} from '@optique/run';

import {createClient, execute, parser} from './cli.ts';

const args = run(parser, {
  programName: 'places',
  help: 'option',
  brief: message`A personal, tag-based place mapping tool.`,
  description: message`Manage saved places through the Places server. Commands print JSON; failures print to stderr and exit nonzero.`,
  footer: message`Get started: places tags create 'type:cafe', then places tags list. Use places tags --help to browse commands.`,
});

try {
  const result = await execute(args, createClient(args.server));

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Request failed');
  process.exitCode = 1;
}
