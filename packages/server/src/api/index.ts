import {Hono} from 'hono';

import type {RequestContext} from '../context.ts';

import {importApi} from './imports.ts';

export const api = new Hono<{Variables: RequestContext}>();

api.route('/imports', importApi);
