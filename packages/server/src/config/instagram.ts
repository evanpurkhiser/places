import {tagReference} from '@places/common/contract/tag';
import {z} from 'zod';

export const instagramCaptureConfig = z.strictObject({
  model: z
    .string()
    .min(1)
    .describe('Model used to identify places and assign tags from post content.'),
  reasoningEffort: z
    .enum(['none', 'low', 'medium', 'high'])
    .optional()
    .describe('Reasoning effort requested from the model. Omit to use its default.'),
  instructions: z
    .string()
    .max(20000)
    .default('')
    .describe(
      'Additional guidance for interpreting posts and assigning tags, such as when to use particular tags or which tags to prioritize. The model also receives assignable tags and namespaces with their descriptions.',
    ),
  maxTurns: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(12)
    .describe(
      'Maximum model turns in a capture run, including turns used to request tools.',
    ),
  maxOutputTokens: z
    .number()
    .int()
    .min(100)
    .max(32000)
    .default(8000)
    .describe('Maximum output tokens requested per model response.'),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(600000)
    .default(180000)
    .describe(
      'Time limit in milliseconds for capture. The Instagram importer also uses this budget for scraping and media preparation.',
    ),
});

export const instagramConfig = z
  .strictObject({
    alwaysApplyTags: z
      .array(tagReference)
      .describe(
        'Existing tags added automatically to newly imported places, such as status.needs-review. These tags are excluded from model choices. Use [] for none.',
      ),
    excludedTags: z
      .array(z.string())
      .describe(
        'Additional existing tag names the model cannot assign, such as favorite. Automatic tags are already excluded. Use [] for none.',
      ),
    excludedNamespaces: z
      .array(z.string())
      .describe(
        'Namespaces whose tags the model cannot assign, such as rating for personal ratings. Use [] for none.',
      ),
    requiredNamespaces: z
      .array(z.string())
      .describe(
        'Namespaces from which the model must assign at least one allowed tag per place, such as type for type.cafe or type.restaurant. Use [] for none.',
      ),
    capture: instagramCaptureConfig,
  })
  .describe('Instagram capture settings, tagging rules, and automatic tags.');
