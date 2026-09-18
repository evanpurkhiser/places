import type {Argument, Operator, StringValue} from '../search/types.ts';

/**
 * Expected user-input failure; the engine attaches the expression's source span.
 */
export class InvalidValueError extends Error {}

/**
 * A semantic value type. Decoding is synchronous; resolution may use external data.
 * Decoded literals may differ from T; functions, references, and consumers use T.
 */
export interface ValueType<T, Context = unknown, Decoded = T> {
  name: string;
  description: string;
  decode?(literal: StringValue): Decoded;
  /**
   * Resolves values from literals, functions, and references before their consumer runs.
   */
  resolve?(value: Decoded | T, context: Context, source: Argument): T | Promise<T>;
  resolveReference?(name: string, context: Context): T | Promise<T>;
}

export function valueType<T, Context = unknown>(
  definition: ValueType<T, Context>,
): ValueType<T, Context>;
export function valueType<T, Context, Decoded>(
  definition: ValueType<T, Context, Decoded> &
    ([Decoded] extends [T]
      ? unknown
      : {resolve: NonNullable<ValueType<T, Context, Decoded>['resolve']>}),
): ValueType<T, Context, Decoded>;
export function valueType<T, Context, Decoded>(
  definition: ValueType<T, Context, Decoded>,
): ValueType<T, Context, Decoded> {
  return definition;
}

export interface Parameter<T = unknown, Context = unknown> {
  description: string;
  // Decoding is internal to the value type; consumers receive its resolved value.
  type: ValueType<T, Context, unknown>;
  operators?: readonly Operator[];
  optional?: boolean;
}

export interface PositionalParameter<T = unknown, Context = unknown> extends Parameter<
  T,
  Context
> {
  name: string;
}

/**
 * Read-only access to the filters registered with the invoking engine.
 */
export interface FilterRegistry<Predicate, Context> {
  readonly filters: ReadonlyMap<string, FilterDefinition<Predicate, Context>>;
}

export interface Signature<Context = unknown> {
  positional: ReadonlyArray<PositionalParameter<unknown, Context>>;
  named?: Readonly<Record<string, Parameter<unknown, Context>>>;
  /**
   * Cross-argument constraints run before any asynchronous resolution.
   */
  validate?(
    args: readonly Argument[],
    registry: FilterRegistry<unknown, Context>,
  ): string | undefined;
}

export interface ResolvedArgument<T = unknown> {
  value: T;
  operator: Operator | null;
  source: Argument;
}

type ArgumentFor<P> =
  P extends Parameter<infer T, never>
    ? P extends {optional: true}
      ? ResolvedArgument<T> | undefined
      : ResolvedArgument<T>
    : never;

type ResolvedPositional<P extends readonly unknown[]> = {
  [K in keyof P]: ArgumentFor<P[K]>;
};

export type ResolvedArguments<S extends {positional: readonly unknown[]}> = {
  positional: ResolvedPositional<S['positional']>;
  named: S extends {named: infer N}
    ? {[K in keyof N]: ArgumentFor<N[K]>}
    : Record<never, never>;
};

export interface RuntimeArguments {
  positional: ResolvedArgument[];
  named: Record<string, ResolvedArgument>;
}

export interface QueryExample {
  query: string;
  description?: string;
}

export interface FilterDefinition<Predicate, Context> extends Signature<Context> {
  name: string;
  description: string;
  examples?: readonly QueryExample[];
  compile(
    args: RuntimeArguments,
    context: Context,
    registry: FilterRegistry<Predicate, Context>,
  ): Predicate;
  presence?(context: Context): Predicate;
}

export interface FunctionDefinition<Context> extends Signature<Context> {
  name: string;
  description: string;
  examples?: readonly QueryExample[];
  returns: ValueType<unknown, Context>;
  resolve(args: RuntimeArguments, context: Context): unknown | Promise<unknown>;
}

/**
 * Erasure is confined to registration; handlers see their declared argument types.
 */
export function defineFilter<
  Predicate,
  Context,
  const P extends ReadonlyArray<PositionalParameter<unknown, Context>>,
  const N extends Readonly<Record<string, Parameter<unknown, Context>>> = Record<
    never,
    never
  >,
>(definition: {
  name: string;
  description: string;
  examples?: readonly QueryExample[];
  positional: P;
  named?: N;
  validate?(
    args: readonly Argument[],
    registry: FilterRegistry<unknown, Context>,
  ): string | undefined;
  compile(
    args: ResolvedArguments<{positional: P; named: N}>,
    context: Context,
    registry: FilterRegistry<Predicate, Context>,
  ): Predicate;
  presence?(context: Context): Predicate;
}): FilterDefinition<Predicate, Context> {
  return definition as unknown as FilterDefinition<Predicate, Context>;
}

export function defineFunction<
  T,
  Context,
  const P extends ReadonlyArray<PositionalParameter<unknown, Context>>,
  const N extends Readonly<Record<string, Parameter<unknown, Context>>> = Record<
    never,
    never
  >,
>(definition: {
  name: string;
  description: string;
  examples?: readonly QueryExample[];
  positional: P;
  named?: N;
  validate?(
    args: readonly Argument[],
    registry: FilterRegistry<unknown, Context>,
  ): string | undefined;
  returns: ValueType<T, Context, unknown>;
  resolve(
    args: ResolvedArguments<{positional: P; named: N}>,
    context: Context,
  ): T | Promise<T>;
}): FunctionDefinition<Context> {
  return definition as unknown as FunctionDefinition<Context>;
}
