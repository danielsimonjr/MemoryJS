/**
 * In-repo CLI argument parser for the MemoryJS command tree.
 *
 * It implements the subset of commander 15.0.0 that `src/cli/` and the CLI tests
 * use: a command tree, options (short, long, variadic, negated, choices,
 * defaults, argument parsers), positional arguments, actions, aliases, version
 * output, `parse` / `parseAsync` / `parseOptions`, `exitOverride`,
 * `configureOutput`, and commander-shaped help and error text.
 *
 * The help layout, the option and argument error strings, the exit codes, and
 * the did-you-mean suggestions follow commander 15.0.0, so replacing commander
 * is not visible to a CLI user. See `THIRD_PARTY_NOTICES` for the commander
 * copyright and the MIT license text.
 *
 * @module cli/parseArgs
 */

// Adapted from commander (https://github.com/tj/commander.js), MIT License.
// Copyright (c) 2011 TJ Holowaychuk <tj@vision-media.ca>

import { stripVTControlCharacters } from 'node:util';
import { basename, extname } from 'node:path';

/**
 * Error thrown (or handed to the exit override) when the parser stops a run.
 */
export class CommanderError extends Error {
  code: string;
  exitCode: number;
  nestedError: undefined;

  /**
   * Create a parser error carrying the exit code, a stable code and a message.
   *
   * @param exitCode - The suggested process exit code.
   * @param code - A stable identifier such as `commander.unknownOption`.
   * @param message - The human-readable message.
   */
  constructor(exitCode: number, code: string, message: string) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.code = code;
    this.exitCode = exitCode;
    this.nestedError = undefined;
  }
}

/**
 * Error an option or argument parser throws to reject a value.
 */
export class InvalidArgumentError extends CommanderError {
  /**
   * Create an invalid-argument error carrying exit code 1.
   *
   * @param message - Why the value is invalid.
   */
  constructor(message: string) {
    super(1, 'commander.invalidArgument', message);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
  }
}

/** Convert a kebab-case option name to the camelCase option key. */
function camelcase(value: string): string {
  return value
    .split('-')
    .reduce((acc, word) => acc + word.charAt(0).toUpperCase() + word.slice(1));
}

/**
 * Split a flag string such as `-m, --mixed <value>` into its short and long flags.
 *
 * @param flags - The raw option flag string.
 * @returns The short and long flags, each possibly undefined.
 */
function splitOptionFlags(flags: string): { shortFlag: string | undefined; longFlag: string | undefined } {
  let shortFlag: string | undefined;
  let longFlag: string | undefined;
  const shortFlagExp = /^-[^-]$/;
  const longFlagExp = /^--[^-]/;

  const flagParts = flags.split(/[ |,]+/).concat('guard');
  if (shortFlagExp.test(flagParts[0] ?? '')) shortFlag = flagParts.shift();
  if (longFlagExp.test(flagParts[0] ?? '')) longFlag = flagParts.shift();
  if (!shortFlag && shortFlagExp.test(flagParts[0] ?? '')) shortFlag = flagParts.shift();
  if (!shortFlag && longFlagExp.test(flagParts[0] ?? '')) {
    shortFlag = longFlag;
    longFlag = flagParts.shift();
  }

  const unprocessed = flagParts[0] ?? '';
  if (unprocessed.startsWith('-')) {
    const baseError = `option creation failed due to '${unprocessed}' in option flags '${flags}'`;
    if (/^-[^-][^-]/.test(unprocessed)) {
      throw new Error(
        `${baseError}\n- a short flag is a single dash and a single character\n  - either use a single dash and a single character (for a short flag)\n  - or use a double dash for a long option (and can have two, like '--ws, --workspace')`,
      );
    }
    if (shortFlagExp.test(unprocessed)) throw new Error(`${baseError}\n- too many short flags`);
    if (longFlagExp.test(unprocessed)) throw new Error(`${baseError}\n- too many long flags`);
    throw new Error(`${baseError}\n- unrecognised flag format`);
  }
  if (shortFlag === undefined && longFlag === undefined) {
    throw new Error(`option creation failed due to no flags found in '${flags}'.`);
  }

  return { shortFlag, longFlag };
}

/**
 * One command-line option: its flags, description, and value behaviour.
 */
export class Option {
  flags: string;
  description: string;
  required: boolean;
  optional: boolean;
  variadic: boolean;
  mandatory = false;
  short: string | undefined;
  long: string | undefined;
  negate: boolean;
  defaultValue: unknown = undefined;
  defaultValueDescription: string | undefined = undefined;
  presetArg: unknown = undefined;
  parseArg: ((value: string, previous: unknown) => unknown) | undefined = undefined;
  hidden = false;
  argChoices: string[] | undefined = undefined;

  /**
   * Create an option from a flag string such as `-t, --type <type>`.
   *
   * @param flags - The option flags, including any `<required>` or `[optional]` value.
   * @param description - The help description.
   */
  constructor(flags: string, description?: string) {
    this.flags = flags;
    this.description = description ?? '';
    this.required = flags.includes('<');
    this.optional = flags.includes('[');
    this.variadic = /\w\.\.\.[>\]]$/.test(flags);
    const { shortFlag, longFlag } = splitOptionFlags(flags);
    this.short = shortFlag;
    this.long = longFlag;
    this.negate = this.long !== undefined && this.long.startsWith('--no-');
  }

  /**
   * Set the default value shown in help and used before parsing.
   *
   * @param value - The default value.
   * @param description - Optional help text for the default.
   * @returns This option.
   */
  default(value: unknown, description?: string): this {
    this.defaultValue = value;
    this.defaultValueDescription = description;
    return this;
  }

  /**
   * Restrict the option value to one of `values`.
   *
   * @param values - The allowed values.
   * @returns This option.
   */
  choices(values: string[]): this {
    this.argChoices = values.slice();
    this.parseArg = (arg: string, previous: unknown) => {
      if (!this.argChoices?.includes(arg)) {
        throw new InvalidArgumentError(`Allowed choices are ${this.argChoices?.join(', ')}.`);
      }
      if (this.variadic) return this._collectValue(arg, previous);
      return arg;
    };
    return this;
  }

  /**
   * Return the option name without its dashes.
   */
  name(): string {
    if (this.long) return this.long.replace(/^--/, '');
    return (this.short ?? '').replace(/^-/, '');
  }

  /**
   * Return the camelCase key this option stores its value under.
   */
  attributeName(): string {
    if (this.negate) return camelcase(this.name().replace(/^no-/, ''));
    return camelcase(this.name());
  }

  /**
   * Report whether the option is a plain boolean flag.
   */
  isBoolean(): boolean {
    return !this.required && !this.optional && !this.negate;
  }

  /**
   * Report whether `arg` is this option's short or long flag.
   *
   * @param arg - One argv token.
   */
  is(arg: string): boolean {
    return this.short === arg || this.long === arg;
  }

  /**
   * Append a value to a variadic option's collected array.
   *
   * @param value - The new value.
   * @param previous - The value collected so far.
   */
  _collectValue(value: string, previous: unknown): string[] {
    if (previous === this.defaultValue || !Array.isArray(previous)) return [value];
    previous.push(value);
    return previous as string[];
  }
}

/**
 * One positional command argument, parsed from `<name>`, `[name]` or `name...`.
 */
export class Argument {
  description: string;
  variadic = false;
  parseArg: ((value: string, previous: unknown) => unknown) | undefined = undefined;
  defaultValue: unknown = undefined;
  defaultValueDescription: string | undefined = undefined;
  required: boolean;
  private readonly _name: string;

  /**
   * Create an argument from its bracketed name.
   *
   * @param name - `<required>`, `[optional]`, `name...`, or a bare name.
   * @param description - The help description.
   */
  constructor(name: string, description?: string) {
    this.description = description ?? '';
    let flagName = name;
    const first = name.charAt(0);
    if (first === '<') {
      this.required = true;
      flagName = name.slice(1, -1);
    } else if (first === '[') {
      this.required = false;
      flagName = name.slice(1, -1);
    } else {
      this.required = true;
    }
    if (flagName.endsWith('...')) {
      this.variadic = true;
      flagName = flagName.slice(0, -3);
    }
    this._name = flagName;
  }

  /**
   * Return the argument name without brackets.
   */
  name(): string {
    return this._name;
  }
}

/**
 * Render an argument in the `<name>`, `[name]` or `name...` help form.
 *
 * @param arg - The argument to render.
 */
function humanReadableArgName(arg: Argument): string {
  const nameOutput = arg.name() + (arg.variadic ? '...' : '');
  return arg.required ? '<' + nameOutput + '>' : '[' + nameOutput + ']';
}

/** A custom option-value parser: it receives the raw token and returns the typed value. */
export type OptionParseArg = (value: string) => unknown;

/** The output sinks and terminal probes the parser writes through. */
export interface OutputConfiguration {
  writeOut: (str: string) => void;
  writeErr: (str: string) => void;
  outputError: (str: string, write: (str: string) => void) => void;
  getOutHelpWidth: () => number | undefined;
  getErrHelpWidth: () => number | undefined;
  getOutHasColors: () => boolean | undefined;
  getErrHasColors: () => boolean | undefined;
  stripColor: (str: string) => string;
}

/** Options accepted by `parse` and `parseAsync`. */
export interface ParseOptions {
  from?: 'node' | 'electron' | 'user' | 'eval';
}

/** Context passed when printing help. */
export interface HelpContextOptions {
  error?: boolean;
}

/** Error options accepted by `Command.error`. */
interface CommandErrorOptions {
  code?: string;
  exitCode?: number;
}

/** The result of splitting argv into operands and unknown arguments. */
export interface ParseOptionsResult {
  operands: string[];
  unknown: string[];
}

const MAX_SUGGESTION_DISTANCE = 3;

/**
 * Damerau-Levenshtein distance with a quick worst-case exit.
 *
 * @param a - The first string.
 * @param b - The second string.
 */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > MAX_SUGGESTION_DISTANCE) return Math.max(a.length, b.length);
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Suggest close matches for an unknown flag or command.
 *
 * @param word - The unknown flag or command name.
 * @param candidates - The known flags or command names.
 */
function suggestSimilar(word: string, candidates: string[]): string {
  if (candidates.length === 0) return '';
  const unique = Array.from(new Set(candidates));
  const searchingOptions = word.startsWith('--');
  let target = word;
  let pool = unique;
  if (searchingOptions) {
    target = word.slice(2);
    pool = unique.map((candidate) => candidate.slice(2));
  }

  let similar: string[] = [];
  let bestDistance = MAX_SUGGESTION_DISTANCE;
  const minSimilarity = 0.4;
  for (const candidate of pool) {
    if (candidate.length <= 1) continue;
    const distance = editDistance(target, candidate);
    const length = Math.max(target.length, candidate.length);
    const similarity = (length - distance) / length;
    if (similarity > minSimilarity) {
      if (distance < bestDistance) {
        bestDistance = distance;
        similar = [candidate];
      } else if (distance === bestDistance) {
        similar.push(candidate);
      }
    }
  }

  similar.sort((a, b) => a.localeCompare(b));
  if (searchingOptions) similar = similar.map((candidate) => `--${candidate}`);

  if (similar.length > 1) return `\n(Did you mean one of ${similar.join(', ')}?)`;
  if (similar.length === 1) return `\n(Did you mean ${similar[0]}?)`;
  return '';
}

/**
 * Strip ANSI escape sequences before measuring display width.
 *
 * @param str - The text to measure.
 */
function displayWidth(str: string): number {
  return stripVTControlCharacters(str).length;
}

/**
 * Wrap a description at whitespace, preserving existing line breaks.
 *
 * @param str - The text to wrap.
 * @param width - The available width.
 */
function boxWrap(str: string, width: number): string {
  if (width < 40) return str;
  const rawLines = str.split(/\r\n|\n/);
  const chunkPattern = /[\s]*[^\s]+/g;
  const wrappedLines: string[] = [];
  for (const line of rawLines) {
    const chunks = line.match(chunkPattern);
    if (chunks === null) {
      wrappedLines.push('');
      continue;
    }
    let sumChunks = [chunks.shift() ?? ''];
    let sumWidth = displayWidth(sumChunks[0] ?? '');
    for (const chunk of chunks) {
      const visibleWidth = displayWidth(chunk);
      if (sumWidth + visibleWidth <= width) {
        sumChunks.push(chunk);
        sumWidth += visibleWidth;
        continue;
      }
      wrappedLines.push(sumChunks.join(''));
      const nextChunk = chunk.trimStart();
      sumChunks = [nextChunk];
      sumWidth = displayWidth(nextChunk);
    }
    wrappedLines.push(sumChunks.join(''));
  }
  return wrappedLines.join('\n');
}

/**
 * Format one term/description help row, padding the term and wrapping the description.
 *
 * @param term - The left-hand term.
 * @param termWidth - The shared term column width.
 * @param description - The description text.
 * @param helpWidth - The total help width.
 */
function formatItem(term: string, termWidth: number, description: string, helpWidth: number): string {
  const itemIndent = 2;
  const itemIndentStr = ' '.repeat(itemIndent);
  if (!description) return itemIndentStr + term;
  const paddedTerm = term.padEnd(termWidth + term.length - displayWidth(term));
  const spacerWidth = 2;
  const remainingWidth = helpWidth - termWidth - spacerWidth - itemIndent;
  let formattedDescription: string;
  if (remainingWidth < 40 || /\n[^\S\r\n]/.test(description)) {
    formattedDescription = description;
  } else {
    formattedDescription = boxWrap(description, remainingWidth).replace(
      /\n/g,
      '\n' + ' '.repeat(termWidth + spacerWidth),
    );
  }
  return (
    itemIndentStr +
    paddedTerm +
    ' '.repeat(spacerWidth) +
    formattedDescription.replace(/\n/g, `\n${itemIndentStr}`)
  );
}

/**
 * Add a heading and its rows, or nothing when there are no rows.
 *
 * @param heading - The section heading.
 * @param items - The rendered rows.
 */
function formatItemList(heading: string, items: string[]): string[] {
  if (items.length === 0) return [];
  return [heading, ...items, ''];
}

/**
 * A command in the CLI tree: its subcommands, options, positional arguments,
 * action handler, and help/version configuration.
 */
export class Command {
  commands: Command[] = [];
  options: Option[] = [];
  parent: Command | null = null;
  registeredArguments: Argument[] = [];
  args: string[] = [];
  processedArgs: unknown[] = [];
  rawArgs: string[] = [];

  private _name: string;
  private _description = '';
  private _aliases: string[] = [];
  private _optionValues: Record<string, unknown> = {};
  private _optionValueSources: Record<string, string> = {};
  private _optionHandlers = new Map<string, (value: unknown) => void>();
  private _actionHandler: ((args: unknown[]) => unknown) | null = null;
  private _exitCallback: ((err: CommanderError) => void) | null = null;
  private _version: string | undefined;
  private _helpOption: Option | null | undefined;
  private _helpCommand: Command | undefined;
  private _addImplicitHelpCommand: boolean | undefined;
  private _hidden = false;
  private _scriptPath: string | null = null;
  private _savedState: {
    name: string;
    optionValues: Record<string, unknown>;
    optionValueSources: Record<string, string>;
  } | null = null;
  private _outputConfiguration: OutputConfiguration = {
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => process.stderr.write(str),
    outputError: (str, write) => write(str),
    getOutHelpWidth: () => (process.stdout.isTTY ? process.stdout.columns : undefined),
    getErrHelpWidth: () => (process.stderr.isTTY ? process.stderr.columns : undefined),
    getOutHasColors: () => false,
    getErrHasColors: () => false,
    stripColor: (str) => stripVTControlCharacters(str),
  };

  /**
   * Create a command, optionally named.
   *
   * @param name - The command name.
   */
  constructor(name?: string) {
    this._name = name ?? '';
  }

  /**
   * Copy the settings a subcommand inherits from its parent.
   *
   * @param source - The parent command.
   */
  copyInheritedSettings(source: Command): this {
    this._outputConfiguration = source._outputConfiguration;
    this._helpOption = source._helpOption;
    this._helpCommand = source._helpCommand;
    this._exitCallback = source._exitCallback;
    return this;
  }

  /**
   * Create a new unattached command for a subcommand.
   *
   * @param name - The subcommand name.
   */
  createCommand(name?: string): Command {
    return new Command(name);
  }

  /**
   * Define a subcommand from a `name <arg> [arg...]` string.
   *
   * @param nameAndArgs - The subcommand name and its positional arguments.
   * @returns The new subcommand, for chaining.
   */
  command(nameAndArgs: string): Command {
    const match = nameAndArgs.match(/([^ ]+) *(.*)/);
    const name = match?.[1] ?? nameAndArgs;
    const args = match?.[2] ?? '';
    const cmd = this.createCommand(name);
    if (args) cmd.arguments(args);
    this._registerCommand(cmd);
    cmd.parent = this;
    cmd.copyInheritedSettings(this);
    return cmd;
  }

  /**
   * Add positional arguments parsed from a space-separated argument string.
   *
   * @param names - For example `<from> <to>` or `<text...>`.
   */
  arguments(names: string): this {
    for (const name of names.split(/ +/).filter(Boolean)) {
      this.registeredArguments.push(new Argument(name));
    }
    return this;
  }

  /** Register a command with this command's subcommand list. */
  private _registerCommand(command: Command): void {
    const knownBy = (cmd: Command): string[] => [cmd.name(), ...cmd.aliases()];
    const alreadyUsed = knownBy(command).find((name) => this._findCommand(name));
    if (alreadyUsed) {
      const existing = knownBy(this._findCommand(alreadyUsed) as Command).join('|');
      const next = knownBy(command).join('|');
      throw new Error(`cannot add command '${next}' as already have command '${existing}'`);
    }
    this.commands.push(command);
  }

  /** Register an option with this command's option list. */
  private _registerOption(option: Option): void {
    const matchingOption =
      (option.short ? this._findOption(option.short) : undefined) ??
      (option.long ? this._findOption(option.long) : undefined);
    if (matchingOption) {
      const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
      throw new Error(
        `Cannot add option '${option.flags}'${this._name ? ` to command '${this._name}'` : ''} due to conflicting flag '${matchingFlag}'\n-  already used by option '${matchingOption.flags}'`,
      );
    }
    this.options.push(option);
  }

  /**
   * Add a prepared option.
   *
   * @param option - The option to add.
   */
  addOption(option: Option): this {
    this._registerOption(option);
    const oname = option.name();
    const name = option.attributeName();

    if (option.defaultValue !== undefined) this.setOptionValueWithSource(name, option.defaultValue, 'default');

    const handleOptionValue = (val: unknown, invalidValueMessage: string, valueSource: string): void => {
      let value = val;
      if (value == null && option.presetArg !== undefined) value = option.presetArg;
      const oldValue = this.getOptionValue(name);
      if (value !== null && option.parseArg) {
        value = this._callParseArg(option, value as string, oldValue, invalidValueMessage);
      } else if (value !== null && option.variadic) {
        value = option._collectValue(value as string, oldValue);
      }
      if (value == null) {
        if (option.negate) value = false;
        else if (option.isBoolean() || option.optional) value = true;
        else value = '';
      }
      this.setOptionValueWithSource(name, value, valueSource);
    };

    this._optionHandlers.set(oname, (val) => {
      const invalidValueMessage = `error: option '${option.flags}' argument '${String(val)}' is invalid.`;
      handleOptionValue(val, invalidValueMessage, 'cli');
    });

    return this;
  }

  /** Run an argument parser, reporting an invalid value through `error`. */
  private _callParseArg(
    target: Option,
    value: string,
    previous: unknown,
    invalidArgumentMessage: string,
  ): unknown {
    try {
      return target.parseArg ? target.parseArg(value, previous) : value;
    } catch (err) {
      const candidate = err as { code?: string; exitCode?: number; message?: string };
      if (candidate.code === 'commander.invalidArgument') {
        this.error(`${invalidArgumentMessage} ${candidate.message ?? ''}`, {
          exitCode: candidate.exitCode,
          code: candidate.code,
        });
      }
      throw err;
    }
  }

  /** Shared implementation of `option` and `requiredOption`. */
  private _optionEx(flags: string | Option, description: string | undefined, fn: unknown, defaultValue?: unknown): this {
    if (flags instanceof Option) {
      throw new Error('To add an Option object use addOption() instead of option() or requiredOption()');
    }
    const option = new Option(flags as string, description);
    if (typeof fn === 'function') {
      option.default(defaultValue);
      option.parseArg = fn as (value: string, previous: unknown) => unknown;
    } else {
      option.default(fn);
    }
    return this.addOption(option);
  }

  /**
   * Define an option.
   *
   * @param flags - The option flags, including any value placeholder.
   * @param description - The help description.
   * @param parseArgOrDefault - An argument parser, or the default value.
   * @param defaultValue - The default value when a parser is given.
   */
  option(flags: string, description: string, parseArg: OptionParseArg, defaultValue?: unknown): this;
  option(flags: string, description?: string, defaultValue?: unknown): this;
  option(flags: string, description?: string, parseArgOrDefault?: unknown, defaultValue?: unknown): this {
    return this._optionEx(flags, description, parseArgOrDefault, defaultValue);
  }

  /**
   * Define an option that must be supplied.
   *
   * @param flags - The option flags, including any value placeholder.
   * @param description - The help description.
   * @param parseArgOrDefault - An argument parser, or the default value.
   * @param defaultValue - The default value when a parser is given.
   */
  requiredOption(flags: string, description: string, parseArg: OptionParseArg, defaultValue?: unknown): this;
  requiredOption(flags: string, description?: string, defaultValue?: unknown): this;
  requiredOption(flags: string, description?: string, parseArgOrDefault?: unknown, defaultValue?: unknown): this {
    this._optionEx(flags, description, parseArgOrDefault, defaultValue);
    const option = this.options[this.options.length - 1];
    if (option) option.mandatory = true;
    return this;
  }

  /**
   * Register the action handler run when this command is invoked.
   *
   * @param fn - The handler, called with the positional arguments, the options, and this command.
   */
  action(fn: (...args: never[]) => unknown): this {
    this._actionHandler = (args) => {
      const expectedArgsCount = this.registeredArguments.length;
      const actionArgs = args.slice(0, expectedArgsCount);
      actionArgs[expectedArgsCount] = this.opts();
      actionArgs.push(this);
      return (fn as (...callArgs: unknown[]) => unknown)(...actionArgs);
    };
    return this;
  }

  /**
   * Get every alias for this command.
   */
  aliases(): string[] {
    return this._aliases;
  }

  /**
   * Set or get the first alias for this command.
   *
   * @param alias - The alias to add when supplied.
   */
  alias(): string | undefined;
  alias(alias: string): this;
  alias(alias?: string): this | string | undefined {
    if (alias === undefined) return this._aliases[0];
    if (alias === this._name) throw new Error("Command alias can't be the same as its name");
    const matching = this.parent?._findCommand(alias);
    if (matching) {
      const existing = [matching.name(), ...matching.aliases()].join('|');
      throw new Error(
        `cannot add alias '${alias}' to command '${this.name()}' as already have command '${existing}'`,
      );
    }
    this._aliases.push(alias);
    return this;
  }

  /**
   * Get or set the command name.
   *
   * @param str - The new name when supplied.
   */
  name(): string;
  name(str: string): this;
  name(str?: string): this | string {
    if (str === undefined) return this._name;
    this._name = str;
    return this;
  }

  /**
   * Get or set the command description.
   *
   * @param str - The new description when supplied.
   */
  description(): string;
  description(str: string): this;
  description(str?: string): this | string {
    if (str === undefined) return this._description;
    this._description = str;
    return this;
  }

  /**
   * Get or set the program version, registering the version option.
   *
   * @param str - The version string when supplied.
   * @param flags - The version option flags, default `-V, --version`.
   * @param description - The version option description.
   */
  version(): string | undefined;
  version(str: string, flags?: string, description?: string): this;
  version(str?: string, flags?: string, description?: string): this | string | undefined {
    if (str === undefined) return this._version;
    this._version = str;
    const versionOption = new Option(flags ?? '-V, --version', description ?? 'output the version number');
    this._registerOption(versionOption);
    this._optionHandlers.set(versionOption.name(), () => {
      this._outputConfiguration.writeOut(`${str}\n`);
      this._exit(0, 'commander.version', str);
    });
    return this;
  }

  /**
   * Build the usage string for this command.
   */
  usage(): string {
    const args = this.registeredArguments.map((arg) => humanReadableArgName(arg));
    const parts: string[] = [];
    if (this.options.length || this._helpOption !== null) parts.push('[options]');
    if (this.commands.length) parts.push('[command]');
    parts.push(...args);
    return parts.join(' ');
  }

  /**
   * Return this command's option values.
   */
  opts(): Record<string, unknown> {
    return this._optionValues;
  }

  /**
   * Read one option value.
   *
   * @param key - The camelCase option key.
   */
  getOptionValue(key: string): unknown {
    return this._optionValues[key];
  }

  /**
   * Read where one option value came from.
   *
   * @param key - The camelCase option key.
   */
  getOptionValueSource(key: string): string | undefined {
    return this._optionValueSources[key];
  }

  /**
   * Store an option value with its source.
   *
   * @param key - The camelCase option key.
   * @param value - The value.
   * @param source - Where the value came from, such as `cli` or `default`.
   */
  setOptionValueWithSource(key: string, value: unknown, source: string): void {
    this._optionValues[key] = value;
    this._optionValueSources[key] = source;
  }

  /**
   * Customise the output sinks and terminal probes.
   *
   * @param configuration - The fields to override.
   */
  configureOutput(): OutputConfiguration;
  configureOutput(configuration: Partial<OutputConfiguration>): this;
  configureOutput(configuration?: Partial<OutputConfiguration>): this | OutputConfiguration {
    if (configuration === undefined) return this._outputConfiguration;
    this._outputConfiguration = { ...this._outputConfiguration, ...configuration };
    return this;
  }

  /**
   * Replace the default process exit with a callback.
   *
   * @param fn - The callback, which normally throws. Defaults to throwing the error.
   */
  exitOverride(fn?: (err: CommanderError) => void): this {
    this._exitCallback =
      fn ??
      ((err) => {
        if (err.code !== 'commander.executeSubCommandAsync') throw err;
      });
    return this;
  }

  /** Report an error and stop the run. */
  private _exit(exitCode: number, code: string, message: string): never {
    if (this._exitCallback) this._exitCallback(new CommanderError(exitCode, code, message));
    process.exit(exitCode);
  }

  /**
   * Print an error message and stop the run.
   *
   * @param message - The message to print.
   * @param errorOptions - Optional `code` and `exitCode`.
   */
  error(message: string, errorOptions?: CommandErrorOptions): never {
    this._outputConfiguration.outputError(`${message}\n`, this._outputConfiguration.writeErr);
    const exitCode = errorOptions?.exitCode ?? 1;
    const code = errorOptions?.code ?? 'commander.error';
    this._exit(exitCode, code, message);
  }

  /** Return the command and all its ancestors, nearest first. */
  private _getCommandAndAncestors(): Command[] {
    const ancestors = this.parent ? this.parent._getCommandAndAncestors() : [];
    return [this, ...ancestors];
  }

  /** Find a subcommand by name or alias. */
  private _findCommand(name: string | undefined): Command | undefined {
    if (!name) return undefined;
    return this.commands.find((cmd) => cmd._name === name || cmd._aliases.includes(name));
  }

  /**
   * Find an option by its short or long flag.
   *
   * @param arg - The flag token.
   */
  findOption(arg: string): Option | undefined {
    return this.options.find((option) => option.is(arg));
  }

  /** Alias kept for the internal option lookup. */
  private _findOption(arg: string): Option | undefined {
    return this.findOption(arg);
  }

  /**
   * Lazily create and return the built-in help option, or null when disabled.
   */
  getHelpOption(): Option | null {
    if (this._helpOption === undefined) this._helpOption = new Option('-h, --help', 'display help for command');
    return this._helpOption;
  }

  /**
   * Lazily create and return the implicit help command, or null when not added.
   */
  getHelpCommand(): Command | null {
    const hasImplicitHelpCommand =
      this._addImplicitHelpCommand ??
      Boolean(this.commands.length && !this._actionHandler && !this._findCommand('help'));
    if (!hasImplicitHelpCommand) return null;
    if (this._helpCommand === undefined) {
      const helpCommand = this.createCommand('help');
      helpCommand._helpOption = null;
      helpCommand.arguments('[command]');
      helpCommand.description('display help for command');
      this._helpCommand = helpCommand;
    }
    return this._helpCommand;
  }

  /** Report whether this command is hidden from its parent's help. */
  isHidden(): boolean {
    return this._hidden;
  }

  /** Reset per-parse state so a command can be parsed more than once. */
  private _prepareForParse(): void {
    if (this._savedState === null) {
      for (const option of this.options) {
        if (
          option.negate &&
          option.defaultValue === undefined &&
          this.getOptionValue(option.attributeName()) === undefined
        ) {
          const positiveLongFlag = (option.long ?? '').replace(/^--no-/, '--');
          if (!this._findOption(positiveLongFlag)) {
            this.setOptionValueWithSource(option.attributeName(), true, 'default');
          }
        }
      }
      this.saveStateBeforeParse();
    } else {
      this.restoreStateBeforeParse();
    }
  }

  /**
   * Snapshot the state that a second `parse` call restores.
   */
  saveStateBeforeParse(): void {
    this._savedState = {
      name: this._name,
      optionValues: { ...this._optionValues },
      optionValueSources: { ...this._optionValueSources },
    };
  }

  /**
   * Restore the state saved before the first `parse` call.
   */
  restoreStateBeforeParse(): void {
    if (!this._savedState) return;
    this._name = this._savedState.name;
    this._scriptPath = null;
    this.rawArgs = [];
    this._optionValues = { ...this._savedState.optionValues };
    this._optionValueSources = { ...this._savedState.optionValueSources };
    this.args = [];
    this.processedArgs = [];
  }

  /** Extract the user arguments from argv according to `parseOptions.from`. */
  private _prepareUserArgs(argv?: string[], parseOptions?: ParseOptions): string[] {
    if (argv !== undefined && !Array.isArray(argv)) {
      throw new Error('first parameter to parse must be array or undefined');
    }
    const options: ParseOptions = parseOptions ?? {};
    if (argv === undefined && options.from === undefined) {
      const execArgv = process.execArgv ?? [];
      if (
        execArgv.includes('-e') ||
        execArgv.includes('--eval') ||
        execArgv.includes('-p') ||
        execArgv.includes('--print')
      ) {
        options.from = 'eval';
      }
    }
    const args = argv ?? process.argv;
    this.rawArgs = args.slice();

    let userArgs: string[];
    switch (options.from) {
      case undefined:
      case 'node':
      case 'electron':
        this._scriptPath = args[1] ?? null;
        userArgs = args.slice(2);
        break;
      case 'user':
        userArgs = args.slice(0);
        break;
      case 'eval':
        userArgs = args.slice(1);
        break;
      default:
        throw new Error(`unexpected parse option { from: '${String(options.from)}' }`);
    }

    if (!this._name && this._scriptPath) this._name = basename(this._scriptPath, extname(this._scriptPath));
    this._name = this._name || 'program';
    return userArgs;
  }

  /**
   * Parse argv, setting option values and running the matching action.
   *
   * @param argv - The raw argument vector, default `process.argv`.
   * @param parseOptions - Where the user arguments start.
   */
  parse(argv?: string[], parseOptions?: ParseOptions): this {
    this._prepareForParse();
    const userArgs = this._prepareUserArgs(argv, parseOptions);
    this._parseCommand([], userArgs);
    return this;
  }

  /**
   * Parse argv, awaiting any promise the action returns.
   *
   * @param argv - The raw argument vector, default `process.argv`.
   * @param parseOptions - Where the user arguments start.
   */
  async parseAsync(argv?: string[], parseOptions?: ParseOptions): Promise<this> {
    this._prepareForParse();
    const userArgs = this._prepareUserArgs(argv, parseOptions);
    await this._parseCommand([], userArgs);
    return this;
  }

  /**
   * Split args into operands and unknown arguments, setting known option values.
   *
   * @param args - The argument tokens to split.
   */
  parseOptions(args: string[]): ParseOptionsResult {
    const operands: string[] = [];
    const unknown: string[] = [];
    let dest = operands;

    const maybeOption = (arg: string): boolean => arg.length > 1 && arg[0] === '-';

    const negativeNumberArg = (arg: string): boolean => {
      if (!/^-(\d+|\d*\.\d+)(e[+-]?\d+)?$/.test(arg)) return false;
      return !this._getCommandAndAncestors().some((cmd) =>
        cmd.options.map((opt) => opt.short).some((short) => /^-\d$/.test(short ?? '')),
      );
    };

    let activeVariadicOption: Option | null = null;
    let activeGroup: string | null = null;
    let i = 0;
    while (i < args.length || activeGroup) {
      const arg: string = activeGroup ?? args[i++] ?? '';
      activeGroup = null;

      if (arg === '--') {
        if (dest === unknown) dest.push(arg);
        dest.push(...args.slice(i));
        break;
      }

      if (activeVariadicOption && (!maybeOption(arg) || negativeNumberArg(arg))) {
        this._emitOption(activeVariadicOption, arg);
        continue;
      }
      activeVariadicOption = null;

      if (maybeOption(arg)) {
        const option = this._findOption(arg);
        if (option) {
          if (option.required) {
            const value = args[i++];
            if (value === undefined) this.optionMissingArgument(option);
            this._emitOption(option, value);
          } else if (option.optional) {
            let value: string | null = null;
            if (i < args.length && (!maybeOption(args[i]) || negativeNumberArg(args[i]))) {
              value = args[i++];
            }
            this._emitOption(option, value);
          } else {
            this._emitOption(option, undefined);
          }
          activeVariadicOption = option.variadic ? option : null;
          continue;
        }
      }

      if (arg.length > 2 && arg[0] === '-' && arg[1] !== '-') {
        const option = this._findOption(`-${arg[1]}`);
        if (option) {
          if (option.required || option.optional) {
            this._emitOption(option, arg.slice(2));
          } else {
            this._emitOption(option, undefined);
            activeGroup = `-${arg.slice(2)}`;
          }
          continue;
        }
      }

      if (/^--[^=]+=/.test(arg)) {
        const index = arg.indexOf('=');
        const option = this._findOption(arg.slice(0, index));
        if (option && (option.required || option.optional)) {
          this._emitOption(option, arg.slice(index + 1));
          continue;
        }
      }

      if (dest === operands && maybeOption(arg) && !(this.commands.length === 0 && negativeNumberArg(arg))) {
        dest = unknown;
      }

      dest.push(arg);
    }

    return { operands, unknown };
  }

  /** Run a registered option handler for one flag occurrence. */
  private _emitOption(option: Option, value: unknown): void {
    const handler = this._optionHandlers.get(option.name());
    if (handler) handler(value);
  }

  /** Parse the arguments for this command, dispatching a subcommand when present. */
  private _parseCommand(operands: string[], unknown: string[]): unknown {
    const parsed = this.parseOptions(unknown);
    const allOperands = operands.concat(parsed.operands);
    const allUnknown = parsed.unknown;
    this.args = allOperands.concat(allUnknown);

    if (allOperands[0] && this._findCommand(allOperands[0])) {
      return this._dispatchSubcommand(allOperands[0], allOperands.slice(1), allUnknown);
    }
    const helpCommand = this.getHelpCommand();
    if (helpCommand && allOperands[0] === helpCommand.name()) {
      return this._dispatchHelpCommand(allOperands[1]);
    }
    if (this.commands.length && this.args.length === 0 && !this._actionHandler) {
      this.help({ error: true });
    }

    this._outputHelpIfRequested(allUnknown);
    this._checkForMissingMandatoryOptions();

    const checkForUnknownOptions = (): void => {
      if (allUnknown.length > 0) this.unknownOption(allUnknown[0]);
    };

    if (this._actionHandler) {
      checkForUnknownOptions();
      this._processArguments();
      return this._actionHandler(this.processedArgs);
    }
    if (allOperands.length) {
      if (this.commands.length) {
        this.unknownCommand();
      } else {
        checkForUnknownOptions();
        this._processArguments();
      }
    } else if (this.commands.length) {
      checkForUnknownOptions();
      this.help({ error: true });
    } else {
      checkForUnknownOptions();
      this._processArguments();
    }
    return undefined;
  }

  /** Parse a subcommand with the remaining operands and unknown arguments. */
  private _dispatchSubcommand(commandName: string, operands: string[], unknown: string[]): unknown {
    const subCommand = this._findCommand(commandName);
    if (!subCommand) this.help({ error: true });
    const command = subCommand as Command;
    command._prepareForParse();
    return command._parseCommand(operands, unknown);
  }

  /** Show help for a `help <command>` invocation. */
  private _dispatchHelpCommand(subcommandName: string | undefined): unknown {
    if (!subcommandName) this.help();
    const subCommand = this._findCommand(subcommandName);
    if (subCommand) return subCommand.help();
    const helpOption = this.getHelpOption();
    return this._dispatchSubcommand(subcommandName as string, [], [
      helpOption?.long ?? helpOption?.short ?? '--help',
    ]);
  }

  /** Report missing required arguments and excess arguments. */
  private _checkNumberOfArguments(): void {
    this.registeredArguments.forEach((arg, i) => {
      if (arg.required && this.args[i] == null) this.missingArgument(arg.name());
    });
    if (
      this.registeredArguments.length > 0 &&
      this.registeredArguments[this.registeredArguments.length - 1]?.variadic
    ) {
      return;
    }
    if (this.args.length > this.registeredArguments.length) this._excessArguments(this.args);
  }

  /** Map positional arguments onto declared arguments, collecting variadic ones. */
  private _processArguments(): void {
    this._checkNumberOfArguments();
    const processedArgs: unknown[] = [];
    this.registeredArguments.forEach((declaredArg, index) => {
      let value = declaredArg.defaultValue;
      if (declaredArg.variadic) {
        if (index < this.args.length) {
          value = this.args.slice(index);
        } else if (value === undefined) {
          value = [];
        }
      } else if (index < this.args.length) {
        value = this.args[index];
      }
      processedArgs[index] = value;
    });
    this.processedArgs = processedArgs;
  }

  /** Report any mandatory option that was not supplied. */
  private _checkForMissingMandatoryOptions(): void {
    for (const cmd of this._getCommandAndAncestors()) {
      for (const option of cmd.options) {
        if (option.mandatory && cmd.getOptionValue(option.attributeName()) === undefined) {
          cmd.missingMandatoryOptionValue(option);
        }
      }
    }
  }

  /**
   * Report a missing required argument.
   *
   * @param name - The argument name.
   */
  missingArgument(name: string): void {
    this.error(`error: missing required argument '${name}'`, { code: 'commander.missingArgument' });
  }

  /**
   * Report an option whose required value was not supplied.
   *
   * @param option - The option that is missing its value.
   */
  optionMissingArgument(option: Option): void {
    this.error(`error: option '${option.flags}' argument missing`, {
      code: 'commander.optionMissingArgument',
    });
  }

  /**
   * Report a mandatory option that was not supplied.
   *
   * @param option - The mandatory option.
   */
  missingMandatoryOptionValue(option: Option): void {
    this.error(`error: required option '${option.flags}' not specified`, {
      code: 'commander.missingMandatoryOptionValue',
    });
  }

  /**
   * Report an unknown option, with a did-you-mean suggestion.
   *
   * @param flag - The unknown flag.
   */
  unknownOption(flag: string): void {
    let suggestion = '';
    if (flag.startsWith('--')) {
      const candidateFlags = this._getCommandAndAncestors().flatMap((cmd) =>
        visibleOptions(cmd)
          .filter((option) => option.long)
          .map((option) => option.long as string),
      );
      suggestion = suggestSimilar(flag, candidateFlags);
    }
    this.error(`error: unknown option '${flag}'${suggestion}`, { code: 'commander.unknownOption' });
  }

  /** Report more positional arguments than the command declares. */
  private _excessArguments(receivedArgs: string[]): void {
    const expected = this.registeredArguments.length;
    const s = expected === 1 ? '' : 's';
    const forSubcommand = this.parent ? ` for '${this.name()}'` : '';
    const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}: ${receivedArgs.join(', ')}.`;
    this.error(message, { code: 'commander.excessArguments' });
  }

  /** Report an unknown subcommand, with a did-you-mean suggestion. */
  unknownCommand(): void {
    const unknownName = this.args[0] ?? '';
    const candidateNames: string[] = [];
    for (const command of visibleCommands(this)) {
      candidateNames.push(command.name());
      const alias = command.alias();
      if (alias) candidateNames.push(alias);
    }
    const suggestion = suggestSimilar(unknownName, candidateNames);
    this.error(`error: unknown command '${unknownName}'${suggestion}`, { code: 'commander.unknownCommand' });
  }

  /** Output help when a help flag is present, then stop the run. */
  private _outputHelpIfRequested(args: string[]): void {
    const helpOption = this.getHelpOption();
    if (!helpOption) return;
    const helpRequested = args.find((arg) => helpOption.is(arg));
    if (helpRequested) {
      this.outputHelp();
      this._exit(0, 'commander.helpDisplayed', '(outputHelp)');
    }
  }

  /** Build the output context for help, honouring the `error` flag. */
  private _getOutputContext(contextOptions?: HelpContextOptions): {
    error: boolean;
    write: (str: string) => void;
    helpWidth: number | undefined;
  } {
    const error = contextOptions?.error === true;
    const baseWrite = error
      ? (str: string): void => this._outputConfiguration.writeErr(str)
      : (str: string): void => this._outputConfiguration.writeOut(str);
    const helpWidth = error
      ? this._outputConfiguration.getErrHelpWidth()
      : this._outputConfiguration.getOutHelpWidth();
    return { error, write: baseWrite, helpWidth };
  }

  /**
   * Return the rendered help text for this command.
   *
   * @param contextOptions - Pass `{ error: true }` to measure against stderr.
   */
  helpInformation(contextOptions?: HelpContextOptions): string {
    const context = this._getOutputContext(contextOptions);
    const helpWidth = context.helpWidth ?? 80;
    return formatHelp(this, helpWidth);
  }

  /**
   * Write the help text to the configured output.
   *
   * @param contextOptions - Pass `{ error: true }` to write to stderr.
   */
  outputHelp(contextOptions?: HelpContextOptions): void {
    const context = this._getOutputContext(contextOptions);
    context.write(this.helpInformation({ error: context.error }));
  }

  /**
   * Write the help text and stop the run.
   *
   * @param contextOptions - Pass `{ error: true }` to write to stderr and exit 1.
   */
  help(contextOptions?: HelpContextOptions): never {
    this.outputHelp(contextOptions);
    let exitCode = Number(process.exitCode ?? 0);
    if (exitCode === 0 && contextOptions?.error) exitCode = 1;
    this._exit(exitCode, 'commander.help', '(outputHelp)');
  }
}

/**
 * The options shown in help: registered options plus the built-in help option.
 *
 * @param cmd - The command whose options to list.
 */
function visibleOptions(cmd: Command): Option[] {
  const visible = cmd.options.filter((option) => !option.hidden);
  const helpOption = cmd.getHelpOption();
  if (helpOption && !helpOption.hidden) {
    const removeShort = helpOption.short ? cmd.findOption(helpOption.short) : undefined;
    const removeLong = helpOption.long ? cmd.findOption(helpOption.long) : undefined;
    if (!removeShort && !removeLong) visible.push(helpOption);
    else if (helpOption.long && !removeLong) visible.push(new Option(helpOption.long, helpOption.description));
    else if (helpOption.short && !removeShort) visible.push(new Option(helpOption.short, helpOption.description));
  }
  return visible;
}

/**
 * The subcommands shown in help, including the implicit help command.
 *
 * @param cmd - The command whose subcommands to list.
 */
function visibleCommands(cmd: Command): Command[] {
  const visible = cmd.commands.filter((sub) => !sub.isHidden());
  const helpCommand = cmd.getHelpCommand();
  if (helpCommand && !helpCommand.isHidden()) visible.push(helpCommand);
  return visible;
}

/**
 * The displayed term for a subcommand row in help.
 *
 * @param cmd - The subcommand.
 */
function subcommandTerm(cmd: Command): string {
  const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(' ');
  const aliases = cmd.aliases();
  return (
    cmd.name() +
    (aliases[0] ? '|' + aliases[0] : '') +
    (cmd.options.length ? ' [options]' : '') +
    (args ? ' ' + args : '')
  );
}

/**
 * The description shown for a subcommand row in help.
 *
 * @param cmd - The subcommand.
 */
function subcommandDescription(cmd: Command): string {
  return cmd.description();
}

/**
 * The option description with choices and default annotations appended.
 *
 * @param option - The option to describe.
 */
function optionDescription(option: Option): string {
  const extraInfo: string[] = [];
  if (option.argChoices) {
    extraInfo.push(`choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(', ')}`);
  }
  if (option.defaultValue !== undefined) {
    const showDefault =
      option.required || option.optional || (option.isBoolean() && typeof option.defaultValue === 'boolean');
    if (showDefault) {
      extraInfo.push(`default: ${option.defaultValueDescription ?? JSON.stringify(option.defaultValue)}`);
    }
  }
  if (extraInfo.length > 0) {
    const extraDescription = `(${extraInfo.join(', ')})`;
    if (option.description) return `${option.description} ${extraDescription}`;
    return extraDescription;
  }
  return option.description;
}

/**
 * The usage line shown under `Usage:` in help.
 *
 * @param cmd - The command to describe.
 */
function commandUsage(cmd: Command): string {
  const aliases = cmd.aliases();
  const cmdName = aliases[0] ? `${cmd.name()}|${aliases[0]}` : cmd.name();
  let ancestorCmdNames = '';
  for (let ancestor = cmd.parent; ancestor; ancestor = ancestor.parent) {
    ancestorCmdNames = `${ancestor.name()} ${ancestorCmdNames}`;
  }
  return `${ancestorCmdNames}${cmdName} ${cmd.usage()}`;
}

/**
 * The widest term in the help table.
 *
 * @param cmd - The command to measure.
 */
function padWidth(cmd: Command): number {
  const optionLengths = visibleOptions(cmd).map((option) => displayWidth(option.flags));
  const commandLengths = visibleCommands(cmd).map((sub) => displayWidth(subcommandTerm(sub)));
  const argumentLengths = cmd.registeredArguments.map((arg) => displayWidth(arg.name()));
  return Math.max(0, ...optionLengths, ...commandLengths, ...argumentLengths);
}

/**
 * Render the full help text for one command.
 *
 * @param cmd - The command to render.
 * @param helpWidth - The available width.
 */
function formatHelp(cmd: Command, helpWidth: number): string {
  const termWidth = padWidth(cmd);
  let output: string[] = [`Usage: ${commandUsage(cmd)}`, ''];

  const description = cmd.description();
  if (description.length > 0) output = output.concat([boxWrap(description, helpWidth), '']);

  const argumentList = cmd.registeredArguments
    .filter((arg) => arg.description)
    .map((arg) => formatItem(arg.name(), termWidth, arg.description, helpWidth));
  output = output.concat(formatItemList('Arguments:', argumentList));

  const optionList = visibleOptions(cmd).map((option) =>
    formatItem(option.flags, termWidth, optionDescription(option), helpWidth),
  );
  output = output.concat(formatItemList('Options:', optionList));

  const commandList = visibleCommands(cmd).map((sub) =>
    formatItem(subcommandTerm(sub), termWidth, subcommandDescription(sub), helpWidth),
  );
  output = output.concat(formatItemList('Commands:', commandList));

  return output.join('\n');
}
