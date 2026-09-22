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
  type FilterEngineDefinition,
  type FilterEngineImplementation,
  type FunctionDefinition,
  type PresenceDefinitions,
  type PresenceRegistry,
  type RuntimeArguments,
  type ValueDefinition,
} from './definitions.ts';
import {describeSignature, type EngineDescription} from './documentation.ts';

const preparedQueryToken = Symbol('prepared query');
const resolvedQueryToken = Symbol('resolved query');

export interface PreparedQuery {
  readonly [preparedQueryToken]: true;
  readonly phase: 'prepared';
  readonly query: Query;
}

export interface ResolvedQuery {
  readonly [resolvedQueryToken]: true;
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

interface RuntimeValue<Context> {
  definition: ValueDefinition<unknown, unknown>;
  resolver?: {
    resolve?(
      value: unknown,
      context: Context,
      operator: Argument['operator'],
    ): unknown | Promise<unknown>;
    resolveReference?(name: string, context: Context): unknown | Promise<unknown>;
  };
}

interface RuntimeFilter<Predicate, Context> {
  definition: FilterDefinition;
  compiler: {
    compile(
      args: RuntimeArguments,
      context: Context,
      presence: PresenceRegistry<Predicate, Context>,
    ): Predicate;
    presence?(context: Context): Predicate;
  };
}

interface PreparedCall<Predicate, Context> {
  filter: RuntimeFilter<Predicate, Context>;
  source: SourceSpan;
  resolve: ResolveArguments<Context>;
}

interface ResolvedCall<Predicate, Context> {
  filter: RuntimeFilter<Predicate, Context>;
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

function registry<T>(
  kind: string,
  definitions: readonly T[],
  name: (value: T) => string,
) {
  const entries = new Map<string, T>();

  for (const definition of definitions) {
    const key = name(definition);

    if (!key || entries.has(key)) {
      throw new Error(`Duplicate or empty ${kind} registration: ${key}`);
    }

    entries.set(key, definition);
  }

  return entries;
}

/** Executes one shared filter-engine definition using host-provided compilers. */
export class FilterEngine<Definition extends FilterEngineDefinition, Predicate, Context> {
  readonly #implementation: FilterEngineImplementation<Definition, Predicate, Context>;
  readonly #values: Map<string, RuntimeValue<Context>>;
  readonly #filters: Map<string, RuntimeFilter<Predicate, Context>>;
  readonly #functions: Map<string, FunctionDefinition>;
  readonly #presenceDefinitions: PresenceDefinitions;
  readonly #presence: PresenceRegistry<Predicate, Context>;
  readonly #prepared = new WeakMap<
    PreparedQuery,
    Tree<PreparedCall<Predicate, Context>>
  >();
  readonly #resolved = new WeakMap<
    ResolvedQuery,
    {tree: Tree<ResolvedCall<Predicate, Context>>; context: Context}
  >();

  constructor(
    definition: Definition,
    implementation: FilterEngineImplementation<Definition, Predicate, Context>,
  ) {
    this.#implementation = implementation;
    this.#values = registry(
      'value',
      Object.entries(definition.values).map(([key, value]) => ({
        definition: value,
        resolver: (
          implementation.valueResolvers as Record<
            string,
            RuntimeValue<Context>['resolver']
          >
        )[key],
      })),
      value => value.definition.name,
    );
    this.#filters = registry(
      'filter',
      Object.entries(definition.filters).map(([key, filter]) => ({
        definition: filter,
        compiler: implementation.filters[
          key as keyof Definition['filters']
        ] as RuntimeFilter<Predicate, Context>['compiler'],
      })),
      filter => filter.definition.name,
    );
    this.#functions = registry(
      'function',
      Object.values(definition.functions),
      fn => fn.name,
    );
    this.#presenceDefinitions = {
      supports: name => this.#filters.get(name)?.definition.supportsPresence ?? false,
    };
    this.#presence = {
      get: name => {
        const compiler = this.#filters.get(name)?.compiler;
        const presence = compiler?.presence;

        return presence ? context => presence.call(compiler, context) : undefined;
      },
    };
    this.#validateRegistrations();
  }

  describe(): EngineDescription {
    return {
      values: [...this.#values.values()].map(({definition}) => ({
        name: definition.name,
        description: definition.description,
        literals: definition.literals,
        references: definition.references,
      })),
      filters: [...this.#filters.values()].map(({definition}) => ({
        ...describeSignature(definition),
        presence: definition.supportsPresence,
      })),
      functions: [...this.#functions.values()].map(fn => ({
        ...describeSignature(fn),
        returns: fn.returns.name,
      })),
    };
  }

  #checkValue(value: ValueDefinition<unknown>) {
    const registration = this.#values.get(value.name);

    if (!registration || registration.definition !== value) {
      throw new Error(`Unregistered value: ${value.name}`);
    }
  }

  #validateRegistrations() {
    for (const {definition, resolver} of this.#values.values()) {
      if (definition.literals !== Boolean(definition.decode)) {
        throw new Error(`Literal capability does not match decoder: ${definition.name}`);
      }

      if (definition.references && !resolver?.resolveReference) {
        throw new Error(`Missing reference resolver: ${definition.name}`);
      }
    }

    for (const {definition, compiler} of this.#filters.values()) {
      if (!compiler) {
        throw new Error(`Missing filter compiler: ${definition.name}`);
      }

      if (definition.supportsPresence !== Boolean(compiler.presence)) {
        throw new Error(
          `Presence capability does not match compiler: ${definition.name}`,
        );
      }

      Object.values(definition.parameters).forEach(parameter =>
        this.#checkValue(parameter.type),
      );
    }

    for (const fn of this.#functions.values()) {
      Object.values(fn.parameters).forEach(parameter => this.#checkValue(parameter.type));
      this.#checkValue(fn.returns);
    }
  }

  #prepareValue(
    source: Argument,
    value: ValueDefinition<unknown>,
  ): ResolveValue<Context> {
    const registration = this.#values.get(value.name)!;
    const resolveInput = this.#prepareInput(source.value, registration);

    return context =>
      withSourceAsync(source.value, async () => {
        const input = await resolveInput(context);
        return registration.resolver?.resolve
          ? registration.resolver.resolve(input, context, source.operator)
          : input;
      });
  }

  #prepareInput(
    value: Value,
    registration: RuntimeValue<Context>,
  ): ResolveValue<Context> {
    if (value.type === 'function') {
      const definition = this.#functions.get(value.name);

      if (!definition) {
        fail('unknown_function', `Unknown function: ${value.name}`, value);
      }

      if (definition.returns !== registration.definition) {
        fail(
          'invalid_value',
          `Function ${value.name} returns ${definition.returns.name}; expected ${registration.definition.name}`,
          value,
        );
      }

      const resolve = this.#prepareArguments(value.arguments, definition, value);
      return context =>
        withSourceAsync(value, async () => definition.evaluate(await resolve(context)));
    }

    if (value.type === 'reference') {
      const resolveReference = registration.resolver?.resolveReference;

      if (!registration.definition.references || !resolveReference || !value.name) {
        fail(
          'invalid_value',
          `Named references are not supported for ${registration.definition.name}`,
          value,
        );
      }

      return context =>
        withSourceAsync(value, () =>
          resolveReference.call(registration.resolver, value.name, context),
        );
    }

    if (!registration.definition.literals || !registration.definition.decode) {
      fail(
        'invalid_value',
        `Expected a function or reference producing ${registration.definition.name}`,
        value,
      );
    }

    const decoded = withSource(value, () => registration.definition.decode!(value));
    return () => Promise.resolve(decoded);
  }

  #prepareArguments(
    args: readonly Argument[],
    signature: FilterDefinition | FunctionDefinition,
    source: SourceSpan,
  ): ResolveArguments<Context> {
    const parameters = Object.entries(signature.parameters);
    const positionalCount = args.filter(argument => argument.name === null).length;

    if (positionalCount > parameters.length) {
      fail(
        'argument_count',
        `Expected at most ${parameters.length} positional arguments; got ${positionalCount}`,
        source,
      );
    }

    let position = 0;
    let namedSeen = false;
    const seen = new Set<string>();
    const plans = args.map(argument => {
      if (argument.name === null && namedSeen) {
        fail(
          'argument_order',
          'Positional arguments must precede named arguments',
          argument,
        );
      }

      namedSeen ||= argument.name !== null;

      const name = argument.name ?? parameters[position++]?.[0];
      const parameter =
        name && Object.hasOwn(signature.parameters, name)
          ? signature.parameters[name]
          : undefined;

      if (!parameter) {
        fail('unknown_argument', `Unknown argument: ${argument.name}`, argument);
      }

      if (seen.has(name)) {
        fail('duplicate_argument', `Duplicate argument: ${name}`, argument);
      }

      seen.add(name);

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

      return {name, argument, resolve: this.#prepareValue(argument, parameter.type)};
    });

    for (const [name, parameter] of parameters) {
      if (!parameter.optional && !seen.has(name)) {
        fail('missing_argument', `Missing argument: ${name}`, source);
      }
    }

    const validationArguments = plans.map(({argument, name}) => ({
      ...argument,
      name,
    }));
    const message =
      'supportsPresence' in signature
        ? signature.validate?.(validationArguments, this.#presenceDefinitions)
        : signature.validate?.(validationArguments);

    if (message) {
      fail('invalid_value', message, source);
    }

    return async context => {
      const resolvedArguments = await Promise.all(
        plans.map(async ({name, argument, resolve}) => ({
          name,
          value: await resolve(context),
          operator: argument.operator,
        })),
      );
      return Object.fromEntries(
        resolvedArguments.map(({name, ...argument}) => [name, argument]),
      );
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

    const filter = this.#filters.get(expression.key);

    if (!filter) {
      fail('unknown_filter', `Unknown filter: ${expression.key}`, expression);
    }

    return {
      kind: 'filter',
      call: {
        filter,
        source: expression,
        resolve: this.#prepareArguments(
          expression.arguments,
          filter.definition,
          expression,
        ),
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
            filter: tree.call.filter,
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
        return this.#implementation.boolean.all();
      case 'filter':
        return withSource(tree.call.source, () =>
          tree.call.filter.compiler.compile(tree.call.arguments, context, this.#presence),
        );
      case 'not':
        return this.#implementation.boolean.not(this.#compileTree(tree.child, context));
      case 'and':
      case 'or':
        return this.#implementation.boolean[tree.kind](
          tree.children.map(child => this.#compileTree(child, context)),
        );
    }
  }

  prepare(input: string): PreparedQuery {
    const query = parseQuery(input);
    const result: PreparedQuery = {
      [preparedQueryToken]: true,
      phase: 'prepared',
      query,
    };
    this.#prepared.set(result, query ? this.#prepareExpression(query) : {kind: 'all'});
    return result;
  }

  async resolve(query: PreparedQuery, context: Context): Promise<ResolvedQuery> {
    const tree = this.#prepared.get(query);

    if (!tree) {
      throw new Error('Query was not prepared by this filter engine');
    }

    const result: ResolvedQuery = {
      [resolvedQueryToken]: true,
      phase: 'resolved',
      query: query.query,
    };
    this.#resolved.set(result, {
      tree: await this.#resolveTree(tree, context),
      context,
    });
    return result;
  }

  compile(query: ResolvedQuery): Predicate {
    const resolved = this.#resolved.get(query);

    if (!resolved) {
      throw new Error('Query was not resolved by this filter engine');
    }

    return this.#compileTree(resolved.tree, resolved.context);
  }

  async execute(query: PreparedQuery, context: Context): Promise<Predicate> {
    return this.compile(await this.resolve(query, context));
  }
}

export function implementFilterEngine<
  const Definition extends FilterEngineDefinition,
  Predicate,
  Context,
>(
  definition: Definition,
  implementation: FilterEngineImplementation<Definition, Predicate, Context>,
): FilterEngine<Definition, Predicate, Context> {
  return new FilterEngine(definition, implementation);
}
