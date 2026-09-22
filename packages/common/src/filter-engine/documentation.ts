import type {Operator} from '../search/types.ts';

import type {Parameter, QueryExample, Signature} from './definitions.ts';

export interface TypeDescription {
  name: string;
  description: string;
  literals: boolean;
  references: boolean;
}

export interface ParameterDescription {
  name: string;
  description: string;
  type: string;
  optional: boolean;
  operators: Operator[];
}

export interface SignatureDescription {
  name: string;
  description: string;
  examples: QueryExample[];
  parameters: ParameterDescription[];
}

export interface FilterDescription extends SignatureDescription {
  presence: boolean;
}

export interface FunctionDescription extends SignatureDescription {
  returns: string;
}

export interface EngineDescription {
  types: TypeDescription[];
  filters: FilterDescription[];
  functions: FunctionDescription[];
}

function describeParameter<Context>(
  name: string,
  parameter: Parameter<unknown, Context>,
): ParameterDescription {
  return {
    name,
    description: parameter.description,
    type: parameter.type.name,
    optional: parameter.optional ?? false,
    operators: [...(parameter.operators ?? [])],
  };
}

export function describeSignature<Context>(
  definition: Signature<Context> & {
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
