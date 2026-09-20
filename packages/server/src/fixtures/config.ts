/**
 * Explicit provider and tagging settings for tests that load server configuration.
 */
export const testConfig = {
  openai: {key: 'test'},
  instagram: {
    alwaysApplyTags: [],
    excludedTags: [],
    excludedNamespaces: [],
    requiredNamespaces: [],
    capture: {model: 'test'},
  },
};
