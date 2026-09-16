import {implement} from '@orpc/server';
import {contract} from '@places/common/contract';

import type {Context} from './context.ts';
import {placeRouter} from './places.ts';
import {tagRouter} from './tags.ts';

export const router = implement(contract)
  .$context<Context>()
  .router({tags: tagRouter, places: placeRouter});
