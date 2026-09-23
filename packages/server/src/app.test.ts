import {afterEach, describe, expect, it} from 'vitest';

import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {createApp} from './app.ts';
import type {Context} from './context.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, {recursive: true, force: true})),
  );
});

async function createWebRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'places-web-'));
  temporaryDirectories.push(root);

  await mkdir(path.join(root, 'assets'));
  await Promise.all([
    writeFile(path.join(root, 'index.html'), '<h1>Places</h1>'),
    writeFile(path.join(root, 'assets', 'app.js'), 'console.log("Places")'),
  ]);

  return root;
}

describe('web app', () => {
  it('serves the app at the root', async () => {
    const webRoot = await createWebRoot();
    const app = createApp({} as Context, {webRoot});
    const response = await app.request('/');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    await expect(response.text()).resolves.toBe('<h1>Places</h1>');
  });

  it('caches built assets indefinitely', async () => {
    const webRoot = await createWebRoot();
    const app = createApp({} as Context, {webRoot});
    const response = await app.request('/assets/app.js');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });
});
