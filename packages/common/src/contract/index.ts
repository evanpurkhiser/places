import type {ContractRouterClient} from '@orpc/contract';

import {tagContract} from './tag.ts';

export const contract = {tags: tagContract};

export type Client = ContractRouterClient<typeof contract>;
