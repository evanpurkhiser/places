import type {Argument, Operator, StringValue} from '../search/types.ts';

/**
 * Reports an expected semantic failure while decoding, resolving, or compiling a
 * user value. The engine converts this error into an `invalid_value` diagnostic
 * at the source expression that triggered it.
 */
export class InvalidValueError extends Error {}

declare const valueType: unique symbol;
declare const decodedType: unique symbol;

/**
 * Defines one semantic value understood by the filter engine.
 *
 * `T` is the value consumed by functions and filter compilers. `Decoded` is the
 * browser-safe result of parsing a literal and may differ from `T` when a host
 * resolver must finish the conversion. The capability flags describe whether
 * query text may supply literals or named references for this value.
 */
export interface ValueDefinition<
  T,
  Decoded = T,
  Literals extends boolean = boolean,
  References extends boolean = boolean,
  Name extends string = string,
> {
  name: Name;
  description: string;
  literals: Literals;
  references: References;
  decode?(literal: StringValue): Decoded;
  readonly [valueType]?: T;
  readonly [decodedType]?: Decoded;
}

/**
 * Extracts the semantic value type produced by a value definition.
 */
export type ValueResult<V> = V extends ValueDefinition<infer T, unknown> ? T : never;

/**
 * Extracts the browser-safe literal decoder result from a value definition.
 */
export type DecodedResult<V> = V extends ValueDefinition<unknown, infer D> ? D : never;

type ValueDefinitionInput<
  Decoded,
  Name extends string,
  Literals extends boolean,
  References extends boolean,
> = {
  name: Name;
  description: string;
  literals: Literals;
  references: References;
} & (Literals extends true ? {decode(literal: StringValue): Decoded} : {decode?: never});

/**
 * Creates a shared value definition while preserving its literal capability,
 * reference capability, name, decoded type, and semantic type for inference.
 */
export function defineValue<T, Decoded = T>() {
  return <
    const Name extends string,
    const Literals extends boolean,
    const References extends boolean,
  >(
    definition: ValueDefinitionInput<Decoded, Name, Literals, References>,
  ): ValueDefinition<T, Decoded, Literals, References, Name> => definition;
}

/**
 * Describes the host-specific handlers available for one value definition.
 *
 * Reference-capable values require `resolveReference`. Values whose literal
 * decoder does not already produce the semantic type require `resolve`. A host
 * may also provide `resolve` for semantic validation or normalization when the
 * decoded and semantic types are the same.
 */
export type ValueResolverFor<
  V extends ValueDefinition<unknown, unknown>,
  Context,
> = (V['references'] extends true
  ? {
      resolveReference(
        name: string,
        context: Context,
      ): ValueResult<V> | Promise<ValueResult<V>>;
    }
  : {resolveReference?: never}) &
  ([DecodedResult<V>] extends [ValueResult<V>]
    ? {
        resolve?(
          value: DecodedResult<V> | ValueResult<V>,
          context: Context,
          operator: Operator | null,
        ): ValueResult<V> | Promise<ValueResult<V>>;
      }
    : {
        resolve(
          value: DecodedResult<V> | ValueResult<V>,
          context: Context,
          operator: Operator | null,
        ): ValueResult<V> | Promise<ValueResult<V>>;
      });

/**
 * Defines one named parameter accepted by a filter or function signature.
 */
export interface Parameter<T = unknown> {
  description: string;
  type: ValueDefinition<T, unknown>;
  operators?: readonly Operator[];
  optional?: boolean;
}

/**
 * Exposes presence capabilities to filter validation during query preparation.
 * It contains definitions only and is safe for shared code to inspect.
 */
export interface PresenceDefinitions {
  supports(name: string): boolean;
}

/**
 * Exposes host presence compilers while resolved filters are compiled.
 */
export interface PresenceRegistry<Predicate, Context> {
  get(name: string): ((context: Context) => Predicate) | undefined;
}

/**
 * Base shape for definitions that bind ordered and named query arguments.
 */
export interface Signature {
  parameters: Readonly<Record<string, Parameter>>;
}

/**
 * Contains one semantic argument after literal decoding, function evaluation,
 * and host resolution. The original comparison operator remains available to
 * the consuming resolver or compiler.
 */
export interface ResolvedArgument<T = unknown> {
  value: T;
  operator: Operator | null;
}

type ArgumentFor<P> = P extends {type: ValueDefinition<infer T, unknown>}
  ? P extends {optional: true}
    ? ResolvedArgument<T> | undefined
    : ResolvedArgument<T>
  : never;

/**
 * Maps a definition's parameter record to the resolved arguments received by
 * its function evaluator or filter compiler, including optional parameters.
 */
export type ResolvedArguments<P> = {[K in keyof P]: ArgumentFor<P[K]>};

/**
 * Type-erased resolved arguments stored by the engine after runtime binding.
 */
export type RuntimeArguments = Record<string, ResolvedArgument>;

/**
 * Documents a complete query that demonstrates a filter or function.
 */
export interface QueryExample {
  query: string;
  description?: string;
}

/**
 * Defines the shared, host-independent surface of a filter.
 *
 * Definitions provide metadata, argument types, preparation-time validation,
 * and presence capability. A host supplies the predicate compiler separately.
 */
export interface FilterDefinition<
  P extends Readonly<Record<string, Parameter>> = Readonly<Record<string, Parameter>>,
> extends Signature {
  name: string;
  description: string;
  examples?: readonly QueryExample[];
  parameters: P;
  supportsPresence: boolean;
  validate?(args: readonly Argument[], presence: PresenceDefinitions): string | undefined;
}

/**
 * Defines a shared function that evaluates resolved arguments into a semantic
 * value. Functions are executable in every host that uses the definition.
 */
export interface FunctionDefinition<
  P extends Readonly<Record<string, Parameter>> = Readonly<Record<string, Parameter>>,
  R extends ValueDefinition<unknown> = ValueDefinition<unknown>,
> extends Signature {
  name: string;
  description: string;
  examples?: readonly QueryExample[];
  parameters: P;
  returns: R;
  validate?(args: readonly Argument[]): string | undefined;
  evaluate(args: ResolvedArguments<P>): ValueResult<R> | Promise<ValueResult<R>>;
}

/**
 * Derives the host compiler required for a particular filter definition.
 * Argument types come from the definition, and presence support conditionally
 * requires a corresponding presence compiler.
 */
export type FilterCompilerFor<D extends FilterDefinition, Predicate, Context> = {
  compile(
    args: ResolvedArguments<D['parameters']>,
    context: Context,
    presence: PresenceRegistry<Predicate, Context>,
  ): Predicate;
} & (D['supportsPresence'] extends true
  ? {presence(context: Context): Predicate}
  : {presence?: never});

/**
 * Creates a filter definition while preserving its exact parameter and
 * presence-capability types for host compiler inference.
 */
export function defineFilter<const D extends FilterDefinition>(definition: D): D {
  return definition;
}

/**
 * Creates a function definition and checks that its evaluator consumes the
 * declared parameters and returns the declared semantic value type.
 */
export function defineFunction<
  const P extends Readonly<Record<string, Parameter>>,
  const R extends ValueDefinition<unknown>,
>(
  definition: Omit<FunctionDefinition<P, R>, 'evaluate'> & {
    evaluate(args: ResolvedArguments<P>): ValueResult<R> | Promise<ValueResult<R>>;
  },
): FunctionDefinition<P, R> {
  return definition;
}

type ValueDefinitions = Readonly<
  Record<string, ValueDefinition<unknown, unknown, boolean, boolean>>
>;
type FilterDefinitions = Readonly<Record<string, FilterDefinition>>;
type FunctionDefinitions = Readonly<Record<string, FunctionDefinition>>;

/**
 * Collects the complete shared catalog of values, filters, and functions for
 * one filter engine. Object keys connect definitions to host implementations;
 * definition names are the names exposed in the query language.
 */
export interface FilterEngineDefinition<
  Values extends ValueDefinitions = ValueDefinitions,
  Filters extends FilterDefinitions = FilterDefinitions,
  Functions extends FunctionDefinitions = FunctionDefinitions,
> {
  values: Values;
  filters: Filters;
  functions: Functions;
}

/**
 * Creates a filter engine definition while retaining the exact keys and
 * definition types needed to check a host implementation.
 */
export function defineFilterEngine<
  const Values extends ValueDefinitions,
  const Filters extends FilterDefinitions,
  const Functions extends FunctionDefinitions,
>(
  definition: FilterEngineDefinition<Values, Filters, Functions>,
): FilterEngineDefinition<Values, Filters, Functions> {
  return definition;
}

type RequiresResolver<V> =
  V extends ValueDefinition<infer T, infer Decoded, boolean, infer References>
    ? References extends true
      ? true
      : [Decoded] extends [T]
        ? false
        : true
    : never;

/**
 * Derives the resolver map for a definition's value catalog. Resolvers are
 * required when a value accepts references or when decoded literals require a
 * host conversion, and optional for values that already decode semantically.
 */
export type ValueResolvers<Values extends ValueDefinitions, Context> = {
  [K in keyof Values as RequiresResolver<Values[K]> extends true
    ? K
    : never]-?: ValueResolverFor<Values[K], Context>;
} & {
  [K in keyof Values as RequiresResolver<Values[K]> extends true
    ? never
    : K]?: ValueResolverFor<Values[K], Context>;
};

/**
 * Derives the complete compiler map required by a definition's filter catalog.
 */
export type FilterCompilers<Filters extends FilterDefinitions, Predicate, Context> = {
  [K in keyof Filters]: FilterCompilerFor<Filters[K], Predicate, Context>;
};

/**
 * Supplies all host-specific behavior needed to execute a shared filter engine
 * definition: value resolution, filter compilation, and predicate composition.
 */
export interface FilterEngineImplementation<
  Definition extends FilterEngineDefinition,
  Predicate,
  Context,
> {
  valueResolvers: ValueResolvers<Definition['values'], Context>;
  filters: FilterCompilers<Definition['filters'], Predicate, Context>;
  boolean: {
    and(predicates: Predicate[]): Predicate;
    or(predicates: Predicate[]): Predicate;
    not(predicate: Predicate): Predicate;
    all(): Predicate;
  };
}
