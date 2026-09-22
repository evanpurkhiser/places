import type {Operator} from '../search/types.ts';

import type {Parameter, QueryExample, Signature} from './definitions.ts';

/**
 * Serializable metadata for a semantic value exposed by a filter engine.
 */
export interface ValueDescription {
  name: string;
  description: string;
  literals: boolean;
  references: boolean;
}

/**
 * Serializable metadata for one named filter or function parameter.
 */
export interface ParameterDescription {
  name: string;
  description: string;
  type: string;
  optional: boolean;
  operators: Operator[];
}

/**
 * Serializable metadata shared by filter and function signatures.
 */
export interface SignatureDescription {
  name: string;
  description: string;
  examples: QueryExample[];
  parameters: ParameterDescription[];
}

/**
 * Serializable filter metadata, including whether the filter can participate
 * in presence queries such as `has[notes]`.
 */
export interface FilterDescription extends SignatureDescription {
  presence: boolean;
}

/**
 * Serializable function metadata, including the semantic value it returns.
 */
export interface FunctionDescription extends SignatureDescription {
  returns: string;
}

/**
 * Complete serializable description of the query surface exposed by a running
 * filter engine. Clients use this data for documentation and search builders.
 */
export interface EngineDescription {
  values: ValueDescription[];
  filters: FilterDescription[];
  functions: FunctionDescription[];
}

function describeParameter(name: string, parameter: Parameter): ParameterDescription {
  return {
    name,
    description: parameter.description,
    type: parameter.type.name,
    optional: parameter.optional ?? false,
    operators: [...(parameter.operators ?? [])],
  };
}

/**
 * Converts a shared filter or function signature into transport-safe metadata.
 * Returned arrays and examples are copies that callers may mutate safely.
 */
export function describeSignature(
  definition: Signature & {
    name: string;
    description: string;
    examples?: readonly QueryExample[];
  },
): SignatureDescription {
  return {
    name: definition.name,
    description: definition.description,
    examples: (definition.examples ?? []).map(example => ({...example})),
    parameters: Object.entries(definition.parameters).map(([name, parameter]) =>
      describeParameter(name, parameter),
    ),
  };
}
