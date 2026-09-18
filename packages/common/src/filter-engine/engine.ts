import {parseQuery, SearchError} from '../search/parser.ts';
import type {
  Argument,
  Diagnostic,
  Expression,
  Query,
  SourceSpan,
  Value,
} from '../search/types.ts';

import {
  InvalidValueError,
  type FilterDefinition,
  type FilterRegistry,
  type FunctionDefinition,
  type RuntimeArguments,
  type Signature,
  type ValueType,
} from './definitions.ts';
import {describeSignature, type EngineDescription} from './documentation.ts';

export interface EngineOptions<Predicate, Context> {
  types: ReadonlyArray<ValueType<unknown, Context>>;
  filters: ReadonlyArray<FilterDefinition<Predicate, Context>>;
  functions?: ReadonlyArray<FunctionDefinition<Context>>;
  boolean: {
    and(predicates: Predicate[]): Predicate;
    or(predicates: Predicate[]): Predicate;
    not(predicate: Predicate): Predicate;
    all(): Predicate;
  };
}

export interface PreparedQuery {
  readonly phase: 'prepared';
  readonly query: Query;
}

export interface ResolvedQuery {
  readonly phase: 'resolved';
  readonly query: Query;
}

type Tree<T> =
  | {kind: 'all'}
  | {kind: 'filter'; call: T}
  | {kind: 'and' | 'or'; children: Array<Tree<T>>}
  | {kind: 'not'; child: Tree<T>};

type ResolveValue<C> = (context: C) => Promise<unknown>;
type ResolveArguments<C> = (context: C) => Promise<RuntimeArguments>;
interface PreparedCall<P, C> {
  definition: FilterDefinition<P, C>;
  source: SourceSpan;
  resolve: ResolveArguments<C>;
}
interface ResolvedCall<P, C> {
  definition: FilterDefinition<P, C>;
  source: SourceSpan;
  arguments: RuntimeArguments;
}

function fail(code: Diagnostic['code'], message: string, source: SourceSpan): never {
  throw new SearchError([{code, message, location: source.location}]);
}

function withSource<T>(source: SourceSpan, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof SearchError) {
      throw error;
    }

    if (error instanceof InvalidValueError) {
      fail('invalid_value', error.message, source);
    }

    throw error;
  }
}

async function withSourceAsync<T>(source: SourceSpan, operation: () => T | Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    return withSource(source, () => {
      throw error;
    });
  }
}

function registry<T extends {name: string}>(kind: string, definitions: readonly T[]) {
  const entries = new Map<string, T>();

  for (const definition of definitions) {
    if (!definition.name || entries.has(definition.name)) {
      throw new Error(`Duplicate or empty ${kind} registration: ${definition.name}`);
    }

    entries.set(definition.name, definition);
  }

  return entries;
}

/**
 * Owns dispatch and boolean composition. Registrations supply all domain behavior.
 */
export class FilterEngine<Predicate, Context> {
  readonly #options: EngineOptions<Predicate, Context>;
  readonly #types: Map<string, ValueType<unknown, Context>>;
  readonly #filters: Map<string, FilterDefinition<Predicate, Context>>;
  readonly #registry: FilterRegistry<Predicate, Context>;
  readonly #functions: Map<string, FunctionDefinition<Context>>;
  readonly #prepared = new WeakMap<
    PreparedQuery,
    Tree<PreparedCall<Predicate, Context>>
  >();
  readonly #resolved = new WeakMap<
    ResolvedQuery,
    Tree<ResolvedCall<Predicate, Context>>
  >();

  constructor(options: EngineOptions<Predicate, Context>) {
    this.#options = options;
    this.#types = registry('type', options.types);
    this.#filters = registry('filter', options.filters);
    this.#registry = {filters: this.#filters};
    this.#functions = registry('function', options.functions ?? []);
    this.#validateRegistrations();
  }

  /**
   * Describes the available registrations without resolving or compiling queries.
   */
  describe(): EngineDescription {
    return {
      types: [...this.#types.values()].map(type => ({
        name: type.name,
        description: type.description,
        literals: Boolean(type.decode),
        references: Boolean(type.resolveReference),
      })),
      filters: [...this.#filters.values()].map(filter => ({
        ...describeSignature(filter),
        presence: Boolean(filter.presence),
      })),
      functions: [...this.#functions.values()].map(fn => ({
        ...describeSignature(fn),
        returns: fn.returns.name,
      })),
    };
  }

  #checkType(type: ValueType<unknown, Context>) {
    if (this.#types.get(type.name) !== type) {
      throw new Error(`Unregistered type: ${type.name}`);
    }
  }

  #validateRegistrations() {
    for (const definition of [...this.#filters.values(), ...this.#functions.values()]) {
      const parameters = [
        ...definition.positional,
        ...Object.values(definition.named ?? {}),
      ];
      parameters.forEach(parameter => this.#checkType(parameter.type));
      let optional = false;

      for (const parameter of definition.positional) {
        if (optional && !parameter.optional) {
          throw new Error(
            `Required positional parameter follows optional parameter: ${definition.name}`,
          );
        }

        optional ||= parameter.optional === true;
      }
    }

    this.#functions.forEach(definition => this.#checkType(definition.returns));
  }

  #prepareValue(
    source: Argument,
    type: ValueType<unknown, Context>,
  ): ResolveValue<Context> {
    const resolve = this.#prepareInput(source.value, type);
    return context =>
      withSourceAsync(source.value, async () => {
        const value = await resolve(context);
        return type.resolve ? type.resolve(value, context, source) : value;
      });
  }

  #prepareInput(value: Value, type: ValueType<unknown, Context>): ResolveValue<Context> {
    if (value.type === 'function') {
      const definition = this.#functions.get(value.name);

      if (!definition) {
        fail('unknown_function', `Unknown function: ${value.name}`, value);
      }

      if (definition.returns !== type) {
        fail(
          'invalid_value',
          `Function ${value.name} returns ${definition.returns.name}; expected ${type.name}`,
          value,
        );
      }

      const resolve = this.#prepareArguments(value.arguments, definition, value);
      return context =>
        withSourceAsync(value, async () =>
          definition.resolve(await resolve(context), context),
        );
    }

    if (value.type === 'reference') {
      const resolveReference = type.resolveReference;

      if (!resolveReference || !value.name) {
        fail(
          'invalid_value',
          `Named references are not supported for ${type.name}`,
          value,
        );
      }

      return context =>
        withSourceAsync(value, () => resolveReference(value.name, context));
    }

    if (!type.decode) {
      fail(
        'invalid_value',
        `Expected a function or reference producing ${type.name}`,
        value,
      );
    }

    const decoded = withSource(value, () => type.decode!(value));
    return () => Promise.resolve(decoded);
  }

  #prepareArguments(
    args: readonly Argument[],
    signature: Signature<Context>,
    source: SourceSpan,
  ): ResolveArguments<Context> {
    const positional = args.filter(argument => argument.name === null);
    const required = signature.positional.filter(parameter => !parameter.optional).length;

    if (positional.length < required || positional.length > signature.positional.length) {
      fail(
        'argument_count',
        `Expected ${required}–${signature.positional.length} positional arguments; got ${positional.length}`,
        source,
      );
    }

    let position = 0;
    const seen = new Set<string>();
    const plans = args.map(argument => {
      if (argument.name === null && seen.size) {
        fail(
          'argument_order',
          'Positional arguments must precede named arguments',
          argument,
        );
      }

      if (argument.name !== null && seen.has(argument.name)) {
        fail('duplicate_argument', `Duplicate argument: ${argument.name}`, argument);
      }

      const parameter =
        argument.name === null
          ? signature.positional[position++]
          : Object.hasOwn(signature.named ?? {}, argument.name)
            ? signature.named![argument.name]
            : undefined;

      if (!parameter) {
        fail('unknown_argument', `Unknown argument: ${argument.name}`, argument);
      }

      if (argument.name !== null) {
        seen.add(argument.name);
      }

      if (
        argument.operator !== null &&
        !parameter.operators?.includes(argument.operator)
      ) {
        fail(
          'invalid_operator',
          `Operator ${argument.operator} is not allowed here`,
          argument,
        );
      }

      return {argument, resolve: this.#prepareValue(argument, parameter.type)};
    });

    for (const [name, parameter] of Object.entries(signature.named ?? {})) {
      if (!parameter.optional && !seen.has(name)) {
        fail('missing_argument', `Missing argument: ${name}`, source);
      }
    }

    const message = signature.validate?.(args, this.#registry);

    if (message) {
      fail('invalid_value', message, source);
    }

    return async context => {
      const arguments_ = await Promise.all(
        plans.map(async ({argument, resolve}) => ({
          value: await resolve(context),
          operator: argument.operator,
          source: argument,
        })),
      );
      return {
        positional: arguments_.filter(argument => argument.source.name === null),
        named: Object.fromEntries(
          arguments_
            .filter(argument => argument.source.name !== null)
            .map(argument => [argument.source.name!, argument]),
        ),
      };
    };
  }

  #prepareExpression(expression: Expression): Tree<PreparedCall<Predicate, Context>> {
    if (expression.type === 'and' || expression.type === 'or') {
      return {
        kind: expression.type,
        children: expression.children.map(child => this.#prepareExpression(child)),
      };
    }

    if (expression.type === 'not') {
      return {kind: 'not', child: this.#prepareExpression(expression.expression)};
    }

    if (expression.type === 'group') {
      return this.#prepareExpression(expression.expression);
    }

    if (expression.type !== 'filter') {
      throw new Error(`Unexpected expression: ${expression.type}`);
    }

    const definition = this.#filters.get(expression.key);

    if (!definition) {
      fail('unknown_filter', `Unknown filter: ${expression.key}`, expression);
    }

    return {
      kind: 'filter',
      call: {
        definition,
        source: expression,
        resolve: this.#prepareArguments(expression.arguments, definition, expression),
      },
    };
  }

  async #resolveTree(
    tree: Tree<PreparedCall<Predicate, Context>>,
    context: Context,
  ): Promise<Tree<ResolvedCall<Predicate, Context>>> {
    switch (tree.kind) {
      case 'all':
        return tree;
      case 'filter':
        return {
          kind: 'filter',
          call: {
            definition: tree.call.definition,
            source: tree.call.source,
            arguments: await tree.call.resolve(context),
          },
        };
      case 'not':
        return {kind: 'not', child: await this.#resolveTree(tree.child, context)};
      case 'and':
      case 'or':
        return {
          kind: tree.kind,
          children: await Promise.all(
            tree.children.map(child => this.#resolveTree(child, context)),
          ),
        };
    }
  }

  #compileTree(
    tree: Tree<ResolvedCall<Predicate, Context>>,
    context: Context,
  ): Predicate {
    switch (tree.kind) {
      case 'all':
        return this.#options.boolean.all();
      case 'filter':
        return withSource(tree.call.source, () =>
          tree.call.definition.compile(tree.call.arguments, context, this.#registry),
        );
      case 'not':
        return this.#options.boolean.not(this.#compileTree(tree.child, context));
      case 'and':
      case 'or':
        return this.#options.boolean[tree.kind](
          tree.children.map(child => this.#compileTree(child, context)),
        );
    }
  }

  prepare(input: string): PreparedQuery {
    const query = parseQuery(input);
    const result: PreparedQuery = {phase: 'prepared', query};
    this.#prepared.set(result, query ? this.#prepareExpression(query) : {kind: 'all'});
    return result;
  }

  async resolve(query: PreparedQuery, context: Context): Promise<ResolvedQuery> {
    const tree = this.#prepared.get(query);

    if (!tree) {
      throw new Error('Query was not prepared by this filter engine');
    }

    const result: ResolvedQuery = {phase: 'resolved', query: query.query};
    this.#resolved.set(result, await this.#resolveTree(tree, context));
    return result;
  }

  compile(query: ResolvedQuery, context: Context): Predicate {
    const tree = this.#resolved.get(query);

    if (!tree) {
      throw new Error('Query was not resolved by this filter engine');
    }

    return this.#compileTree(tree, context);
  }
}

export function createFilterEngine<Predicate, Context>(
  options: EngineOptions<Predicate, Context>,
) {
  return new FilterEngine(options);
}
