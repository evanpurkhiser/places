import type {Argument, Operator, StringValue} from '../search/types.ts';

/**
 * Expected user-input failure; the engine attaches the expression's source span.
 */
export class InvalidValueError extends Error {}

/**
 * A semantic value type. Decoding is synchronous; resolution may use external data.
 */
export interface ValueType<T, Context = unknown> {
  name: string;
  decode?(literal: StringValue): T;
  /**
   * Resolves values from literals, functions, and references before their consumer runs.
   */
  resolve?(value: T, context: Context, source: Argument): T | Promise<T>;
  resolveReference?(name: string, context: Context): T | Promise<T>;
}

export function valueType<T, Context = unknown>(definition: ValueType<T, Context>) {
  return definition;
}

export interface Parameter<T = unknown, Context = unknown> {
  type: ValueType<T, Context>;
  operators?: readonly Operator[];
  optional?: boolean;
}

export interface PositionalParameter<T = unknown, Context = unknown> extends Parameter<
  T,
  Context
> {
  name: string;
}

export interface Signature<Context = unknown> {
  positional: ReadonlyArray<PositionalParameter<unknown, Context>>;
  named?: Readonly<Record<string, Parameter<unknown, Context>>>;
  /**
   * Cross-argument constraints run before any asynchronous resolution.
   */
  validate?(arguments_: readonly Argument[]): string | undefined;
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

export interface FilterDefinition<Predicate, Context> extends Signature<Context> {
  name: string;
  compile(arguments_: RuntimeArguments, context: Context): Predicate;
}

export interface FunctionDefinition<Context> extends Signature<Context> {
  name: string;
  returns: ValueType<unknown, Context>;
  resolve(arguments_: RuntimeArguments, context: Context): unknown | Promise<unknown>;
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
  positional: P;
  named?: N;
  validate?(arguments_: readonly Argument[]): string | undefined;
  compile(
    arguments_: ResolvedArguments<{positional: P; named: N}>,
    context: Context,
  ): Predicate;
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
  positional: P;
  named?: N;
  validate?(arguments_: readonly Argument[]): string | undefined;
  returns: ValueType<T, Context>;
  resolve(
    arguments_: ResolvedArguments<{positional: P; named: N}>,
    context: Context,
  ): T | Promise<T>;
}): FunctionDefinition<Context> {
  return definition as unknown as FunctionDefinition<Context>;
}
