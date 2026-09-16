import {implement} from '@orpc/server';
import {contract} from '@places/common/contract';

import type {Context} from './context.ts';
import {tagRouter} from './tags.ts';

export const router = implement(contract).$context<Context>().router({tags: tagRouter});
