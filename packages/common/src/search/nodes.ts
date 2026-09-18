import type {
  Argument,
  Expression,
  Filter,
  FunctionValue,
  Operator,
  ReferenceValue,
  SourceSpan,
  StringValue,
  Value,
} from './types.ts';

export const nodes = {
  logical(
    type: 'and' | 'or',
    first: Expression,
    rest: Expression[],
    span: SourceSpan,
  ): Expression {
    return rest.length ? {...span, type, children: [first, ...rest]} : first;
  },
  not(expression: Expression, span: SourceSpan): Expression {
    return {...span, type: 'not', expression};
  },
  group(expression: Expression, span: SourceSpan): Expression {
    return {...span, type: 'group', expression};
  },
  filter(key: string, args: Argument[], span: SourceSpan): Filter {
    return {...span, type: 'filter', key, arguments: args};
  },
  function(name: string, args: Argument[], span: SourceSpan): FunctionValue {
    return {...span, type: 'function', name, arguments: args};
  },
  argument(
    name: string | null,
    operator: Operator | null,
    value: Value,
    span: SourceSpan,
  ): Argument {
    return {...span, type: 'argument', name, operator, value};
  },
  reference(name: StringValue, span: SourceSpan): ReferenceValue {
    return {...span, type: 'reference', name: name.value};
  },
  string(
    chars: Array<string | {escaped: string}>,
    quoted: boolean,
    span: SourceSpan,
  ): StringValue {
    const decoded = chars.reduce<{value: string; wildcards: number[]}>(
      (result, char) => ({
        value: result.value + (typeof char === 'string' ? char : char.escaped),
        wildcards:
          char === '*' ? [...result.wildcards, result.value.length] : result.wildcards,
      }),
      {value: '', wildcards: []},
    );

    return {...span, type: 'string', ...decoded, quoted};
  },
};
