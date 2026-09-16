import {common} from '@evanpurkhiser/oxc-config/oxlint';
import {defineConfig} from 'oxlint';

export default defineConfig({
  extends: [common],
  ignorePatterns: ['design/map-prototype/**'],
});
