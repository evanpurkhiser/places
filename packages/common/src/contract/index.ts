import type {RouterContractClient} from '@orpc/contract';

import {namespaceContract} from './namespace.ts';
import {placeContract} from './place.ts';
import {queryContract} from './query.ts';
import {tagContract} from './tag.ts';
import {userContract} from './user.ts';

export const contract = {
  namespaces: namespaceContract,
  tags: tagContract,
  places: placeContract,
  query: queryContract,
  users: userContract,
};

export type Client = RouterContractClient<typeof contract>;
