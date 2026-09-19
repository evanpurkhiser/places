import type {ContractRouterClient} from '@orpc/contract';

import {namespaceContract} from './namespace.ts';
import {placeContract} from './place.ts';
import {queryContract} from './query.ts';
import {tagContract} from './tag.ts';

export const contract = {
  namespaces: namespaceContract,
  tags: tagContract,
  places: placeContract,
  query: queryContract,
};

export type Client = ContractRouterClient<typeof contract>;
