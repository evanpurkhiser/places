import {implement} from '@orpc/server';
import {contract} from '@places/common/contract';

import {placeFilterEngine} from '../filter-engine/index.ts';

export const queryRouter = implement(contract.query).router({
  describe: implement(contract.query.describe).handler(() =>
    placeFilterEngine.describe(),
  ),
});
