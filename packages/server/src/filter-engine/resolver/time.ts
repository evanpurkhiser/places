import {InvalidValueError, type ValueResolverFor} from '@places/common/filter-engine';
import type {time, Time} from '@places/common/filter-engine/values/time';

import type {Context} from '../context.ts';

export const timeResolver = {
  resolveReference: (name, context: Context): Time => {
    if (name !== 'now') {
      throw new InvalidValueError(`Unknown time reference: @${name}. Expected @now.`);
    }

    return {kind: 'instant', epochMilliseconds: context.now};
  },
} satisfies ValueResolverFor<typeof time, Context>;
