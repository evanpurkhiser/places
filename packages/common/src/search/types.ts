export interface Position {
  offset: number;
  line: number;
  column: number;
}

export interface SourceSpan {
  text: string;
  location: {start: Position; end: Position};
}

export type Operator = '=' | '<' | '<=' | '>' | '>=';

export interface StringValue extends SourceSpan {
  type: 'string';
  value: string;
  quoted: boolean;
  /**
   * UTF-16 offsets of unescaped wildcard stars in the decoded value.
   */
  wildcards: number[];
}

export interface ReferenceValue extends SourceSpan {
  type: 'reference';
  name: string;
}

export interface FunctionValue extends SourceSpan {
  type: 'function';
  name: string;
  arguments: Argument[];
}

export type Value = StringValue | ReferenceValue | FunctionValue;

export interface Argument extends SourceSpan {
  type: 'argument';
  name: string | null;
  operator: Operator | null;
  value: Value;
}

export interface Filter extends SourceSpan {
  type: 'filter';
  key: string;
  arguments: Argument[];
}

export type Expression =
  | Filter
  | (SourceSpan & {type: 'and' | 'or'; children: Expression[]})
  | (SourceSpan & {type: 'not' | 'group'; expression: Expression});

export type Query = Expression | null;

export interface Diagnostic {
  code:
    | 'syntax'
    | 'unknown_filter'
    | 'unknown_function'
    | 'argument_count'
    | 'unknown_argument'
    | 'duplicate_argument'
    | 'argument_order'
    | 'missing_argument'
    | 'invalid_operator'
    | 'invalid_value';
  message: string;
  location: SourceSpan['location'];
}
