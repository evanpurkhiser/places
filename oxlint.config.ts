import {common} from '@evanpurkhiser/oxc-config/oxlint';
import {defineConfig} from 'oxlint';

export default defineConfig({
  extends: [common],
  ignorePatterns: ['packages/common/src/search/generated.js'],
});
