import type {ContractRouterClient} from '@orpc/contract';

import {placeContract} from './place.ts';
import {tagContract} from './tag.ts';

export const contract = {tags: tagContract, places: placeContract};

export type Client = ContractRouterClient<typeof contract>;
