import {implement} from '@orpc/server';
import {contract} from '@places/common/contract';

import type {RequestContext} from '../context.ts';

import {namespaceRouter} from './namespaces.ts';
import {placeRouter} from './places.ts';
import {queryRouter} from './query.ts';
import {tagRouter} from './tags.ts';
import {userRouter} from './users.ts';

export const router = implement(contract).$context<RequestContext>().router({
  namespaces: namespaceRouter,
  tags: tagRouter,
  places: placeRouter,
  query: queryRouter,
  users: userRouter,
});
