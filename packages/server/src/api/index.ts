import {Hono} from 'hono';

import type {Context} from '../context.ts';

import {importApi} from './imports.ts';

export const api = new Hono<{Variables: Context}>();

api.route('/imports', importApi);
