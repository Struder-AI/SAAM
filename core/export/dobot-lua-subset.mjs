// Adopted from the explicitly selected legacy Dobot trace/lua-subset.mjs
// (reference-dobot-mg400-struderbot). No legacy postprocessor or inferred
// controller bindings are used; dobot.mjs owns this runtime's bounded hosts.
// A deliberately small Lua interpreter: enough to *execute* the Lua this
// project generates, and nothing more.
//
// Why execute rather than pattern-match: helpers like J() and L() are a
// project convention defined in global.lua, not machine primitives. A
// reader that greps for "J(" has to assume what J means, and would
// inherit whatever assumption the generator made — exactly the class of
// bug a previewer exists to catch. Running the file resolves those
// helpers the way the controller would.
//
// The subset refuses rather than guesses. Any construct it does not
// implement raises LuaSubsetError with a file and line, so a preview is
// never quietly wrong about what the machine was told to do.

export class LuaSubsetError extends Error {
  constructor(message, { file, line } = {}) {
    super(`${file ?? "<lua>"}:${line ?? "?"}: ${message}`);
    this.name = "LuaSubsetError";
    this.file = file ?? null;
    this.line = line ?? null;
  }
}

// ---------------------------------------------------------------- tables

export class LuaTable {
  constructor() {
    this.map = new Map();
  }

  static from(entries) {
    const table = new LuaTable();
    for (const [key, value] of entries) table.set(key, value);
    return table;
  }

  static fromArray(values) {
    const table = new LuaTable();
    values.forEach((value, index) => table.set(index + 1, value));
    return table;
  }

  get(key) {
    const value = this.map.get(key);
    return value === undefined ? null : value;
  }

  set(key, value) {
    if (value === null || value === undefined) this.map.delete(key);
    else this.map.set(key, value);
  }

  // Lua's # over a sequence: the highest n for which 1..n are all present.
  get length() {
    let n = 0;
    while (this.map.has(n + 1)) n += 1;
    return n;
  }

  toArray() {
    const out = [];
    for (let i = 1; i <= this.length; i += 1) out.push(this.get(i));
    return out;
  }
}

// ------------------------------------------------------------- tokenizer

const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while",
]);

// Longest match first, so "==" never tokenizes as two "=".
const OPERATORS = [
  "...", "..", "==", "~=", "<=", ">=",
  "+", "-", "*", "/", "%", "^", "#", "<", ">", "=",
  "(", ")", "{", "}", "[", "]", ";", ":", ",", ".",
];

const SHORT_ESCAPES = {
  n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v",
  "\\": "\\", '"': '"', "'": "'",
};

export function tokenize(source, file = "<lua>") {
  const tokens = [];
  const length = source.length;
  let i = 0;
  let line = 1;

  const fail = (message) => {
    throw new LuaSubsetError(message, { file, line });
  };

  while (i < length) {
    const c = source[i];

    if (c === "\n") { line += 1; i += 1; continue; }
    if (c === " " || c === "\t" || c === "\r") { i += 1; continue; }

    if (c === "-" && source[i + 1] === "-") {
      i += 2;
      const block = matchLongBracket(source, i);
      if (block) {
        line += countNewlines(source, i, block.end);
        i = block.end;
        continue;
      }
      while (i < length && source[i] !== "\n") i += 1;
      continue;
    }

    const longString = matchLongBracket(source, i);
    if (longString) {
      const startLine = line;
      line += countNewlines(source, i, longString.end);
      tokens.push({ type: "string", value: longString.value, line: startLine });
      i = longString.end;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      const startLine = line;
      let out = "";
      i += 1;
      while (i < length && source[i] !== quote) {
        if (source[i] === "\\") {
          const escape = source[i + 1];
          if (escape in SHORT_ESCAPES) { out += SHORT_ESCAPES[escape]; i += 2; continue; }
          if (escape === "\n") { out += "\n"; line += 1; i += 2; continue; }
          if (/[0-9]/.test(escape ?? "")) {
            let digits = "";
            i += 1;
            while (digits.length < 3 && /[0-9]/.test(source[i] ?? "")) { digits += source[i]; i += 1; }
            out += String.fromCharCode(Number(digits));
            continue;
          }
          fail(`unsupported string escape "\\${escape}"`);
        }
        if (source[i] === "\n") fail("unfinished string");
        out += source[i];
        i += 1;
      }
      if (i >= length) fail("unfinished string");
      i += 1;
      tokens.push({ type: "string", value: out, line: startLine });
      continue;
    }

    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const start = i;
      if (c === "0" && /[xX]/.test(source[i + 1] ?? "")) {
        i += 2;
        while (i < length && /[0-9a-fA-F]/.test(source[i])) i += 1;
      } else {
        while (i < length && /[0-9]/.test(source[i])) i += 1;
        if (source[i] === ".") { i += 1; while (i < length && /[0-9]/.test(source[i])) i += 1; }
        if (/[eE]/.test(source[i] ?? "")) {
          i += 1;
          if (/[+-]/.test(source[i] ?? "")) i += 1;
          while (i < length && /[0-9]/.test(source[i])) i += 1;
        }
      }
      const text = source.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) fail(`malformed number "${text}"`);
      tokens.push({ type: "number", value, line });
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < length && /[A-Za-z0-9_]/.test(source[i])) i += 1;
      const word = source.slice(start, i);
      tokens.push({ type: KEYWORDS.has(word) ? "keyword" : "name", value: word, line });
      continue;
    }

    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (!operator) fail(`unexpected character "${c}"`);
    tokens.push({ type: "op", value: operator, line });
    i += operator.length;
  }

  tokens.push({ type: "eof", value: "<eof>", line });
  return tokens;
}

function countNewlines(source, from, to) {
  let count = 0;
  for (let i = from; i < to; i += 1) if (source[i] === "\n") count += 1;
  return count;
}

function matchLongBracket(source, start) {
  if (source[start] !== "[") return null;
  let level = 0;
  let i = start + 1;
  while (source[i] === "=") { level += 1; i += 1; }
  if (source[i] !== "[") return null;
  i += 1;
  if (source[i] === "\n") i += 1;
  const closing = `]${"=".repeat(level)}]`;
  const close = source.indexOf(closing, i);
  if (close === -1) return null;
  return { value: source.slice(i, close), end: close + closing.length };
}

// ---------------------------------------------------------------- parser

// Standard Lua precedence. ".." and "^" are right-associative, which is
// why each entry carries a separate left/right binding power.
const BINARY_PRECEDENCE = {
  or: [1, 1],
  and: [2, 2],
  "<": [3, 3], ">": [3, 3], "<=": [3, 3], ">=": [3, 3], "~=": [3, 3], "==": [3, 3],
  "..": [5, 4],
  "+": [6, 6], "-": [6, 6],
  "*": [7, 7], "/": [7, 7], "%": [7, 7],
  "^": [10, 9],
};
const UNARY_PRECEDENCE = 8;

export function parse(source, file = "<lua>") {
  const tokens = tokenize(source, file);
  let pos = 0;

  const peek = (offset = 0) => tokens[Math.min(pos + offset, tokens.length - 1)];
  const fail = (message, token = peek()) => {
    throw new LuaSubsetError(message, { file, line: token.line });
  };
  const check = (type, value) => {
    const token = peek();
    return token.type === type && (value === undefined || token.value === value);
  };
  const accept = (type, value) => (check(type, value) ? tokens[pos++] : null);
  const expect = (type, value) => {
    const token = accept(type, value);
    if (!token) fail(`expected ${value ?? type}, found "${peek().value}"`);
    return token;
  };

  function parseBlock(terminators) {
    const statements = [];
    for (;;) {
      const token = peek();
      if (token.type === "eof") break;
      if (token.type === "keyword" && terminators.has(token.value)) break;
      if (accept("op", ";")) continue;

      if (token.type === "keyword" && token.value === "return") {
        pos += 1;
        const values = [];
        const next = peek();
        const blockEnds =
          next.type === "eof" ||
          (next.type === "keyword" && terminators.has(next.value)) ||
          (next.type === "op" && next.value === ";");
        if (!blockEnds) {
          values.push(parseExpr());
          while (accept("op", ",")) values.push(parseExpr());
        }
        accept("op", ";");
        statements.push({ kind: "Return", values, line: token.line });
        break; // "return" must be the last statement in its block
      }

      statements.push(parseStatement());
    }
    return { kind: "Block", statements };
  }

  function parseStatement() {
    const token = peek();

    if (token.type === "keyword") {
      switch (token.value) {
        case "local": return parseLocal();
        case "function": return parseFunctionStatement();
        case "if": return parseIf();
        case "while": return parseWhile();
        case "for": return parseFor();
        case "break": pos += 1; return { kind: "Break", line: token.line };
        case "do": {
          pos += 1;
          const body = parseBlock(new Set(["end"]));
          expect("keyword", "end");
          return { kind: "Do", body, line: token.line };
        }
        case "repeat": {
          pos += 1;
          const body = parseBlock(new Set(["until"]));
          expect("keyword", "until");
          return { kind: "Repeat", body, condition: parseExpr(), line: token.line };
        }
        default:
          fail(`"${token.value}" is not supported by the Lua subset reader`);
      }
    }

    // Either a call statement or an assignment: parse a suffixed
    // expression, then decide from what came back.
    const first = parseSuffixed();

    if (check("op", "=") || check("op", ",")) {
      const targets = [first];
      while (accept("op", ",")) targets.push(parseSuffixed());
      expect("op", "=");
      const values = [parseExpr()];
      while (accept("op", ",")) values.push(parseExpr());
      for (const target of targets) {
        if (target.kind !== "Name" && target.kind !== "Index") fail("cannot assign to this expression", token);
      }
      return { kind: "Assign", targets, values, line: token.line };
    }

    if (first.kind !== "Call" && first.kind !== "MethodCall") fail("expected a statement", token);
    return { kind: "CallStatement", call: first, line: token.line };
  }

  function parseLocal() {
    const { line } = expect("keyword", "local");
    if (accept("keyword", "function")) {
      const name = expect("name").value;
      return { kind: "LocalFunction", name, fn: parseFunctionBody(line, name), line };
    }
    const names = [expect("name").value];
    while (accept("op", ",")) names.push(expect("name").value);
    let values = [];
    if (accept("op", "=")) {
      values = [parseExpr()];
      while (accept("op", ",")) values.push(parseExpr());
    }
    return { kind: "Local", names, values, line };
  }

  function parseFunctionStatement() {
    const { line } = expect("keyword", "function");
    let target = { kind: "Name", name: expect("name").value, line };
    let name = target.name;
    while (accept("op", ".")) {
      const key = expect("name").value;
      name += `.${key}`;
      target = { kind: "Index", object: target, key: { kind: "String", value: key, line }, line };
    }
    if (check("op", ":")) fail("method definitions are not supported by the Lua subset reader");
    return { kind: "Assign", targets: [target], values: [parseFunctionBody(line, name)], line };
  }

  function parseFunctionBody(line, name = null) {
    expect("op", "(");
    const params = [];
    let isVararg = false;
    if (!check("op", ")")) {
      for (;;) {
        if (accept("op", "...")) { isVararg = true; break; }
        params.push(expect("name").value);
        if (!accept("op", ",")) break;
      }
    }
    expect("op", ")");
    const body = parseBlock(new Set(["end"]));
    expect("keyword", "end");
    return { kind: "Function", name, params, isVararg, body, line };
  }

  function parseIf() {
    const { line } = expect("keyword", "if");
    const clauses = [];
    const condition = parseExpr();
    expect("keyword", "then");
    clauses.push({ condition, body: parseBlock(new Set(["elseif", "else", "end"])) });

    let orelse = null;
    for (;;) {
      if (accept("keyword", "elseif")) {
        const nextCondition = parseExpr();
        expect("keyword", "then");
        clauses.push({ condition: nextCondition, body: parseBlock(new Set(["elseif", "else", "end"])) });
        continue;
      }
      if (accept("keyword", "else")) orelse = parseBlock(new Set(["end"]));
      break;
    }
    expect("keyword", "end");
    return { kind: "If", clauses, orelse, line };
  }

  function parseWhile() {
    const { line } = expect("keyword", "while");
    const condition = parseExpr();
    expect("keyword", "do");
    const body = parseBlock(new Set(["end"]));
    expect("keyword", "end");
    return { kind: "While", condition, body, line };
  }

  function parseFor() {
    const { line } = expect("keyword", "for");
    const first = expect("name").value;

    if (accept("op", "=")) {
      const start = parseExpr();
      expect("op", ",");
      const limit = parseExpr();
      const step = accept("op", ",") ? parseExpr() : null;
      expect("keyword", "do");
      const body = parseBlock(new Set(["end"]));
      expect("keyword", "end");
      return { kind: "NumericFor", name: first, start, limit, step, body, line };
    }

    const names = [first];
    while (accept("op", ",")) names.push(expect("name").value);
    expect("keyword", "in");
    const exprs = [parseExpr()];
    while (accept("op", ",")) exprs.push(parseExpr());
    expect("keyword", "do");
    const body = parseBlock(new Set(["end"]));
    expect("keyword", "end");
    return { kind: "GenericFor", names, exprs, body, line };
  }

  function parseExpr(limit = 0) {
    let left;
    const token = peek();

    if ((token.type === "keyword" && token.value === "not") ||
        (token.type === "op" && (token.value === "-" || token.value === "#"))) {
      pos += 1;
      left = { kind: "Unary", op: token.value, operand: parseExpr(UNARY_PRECEDENCE), line: token.line };
    } else {
      left = parseSimple();
    }

    for (;;) {
      const operator = peek();
      const key = operator.type === "op" || operator.type === "keyword" ? operator.value : null;
      const precedence = key ? BINARY_PRECEDENCE[key] : undefined;
      if (!precedence || precedence[0] <= limit) break;
      pos += 1;
      left = { kind: "Binary", op: key, left, right: parseExpr(precedence[1]), line: operator.line };
    }
    return left;
  }

  function parseSimple() {
    const token = peek();
    if (token.type === "number") { pos += 1; return { kind: "Number", value: token.value, line: token.line }; }
    if (token.type === "string") { pos += 1; return { kind: "String", value: token.value, line: token.line }; }
    if (token.type === "keyword") {
      if (token.value === "nil") { pos += 1; return { kind: "Nil", line: token.line }; }
      if (token.value === "true") { pos += 1; return { kind: "Boolean", value: true, line: token.line }; }
      if (token.value === "false") { pos += 1; return { kind: "Boolean", value: false, line: token.line }; }
      if (token.value === "function") { pos += 1; return parseFunctionBody(token.line); }
    }
    if (token.type === "op" && token.value === "{") return parseTable();
    if (token.type === "op" && token.value === "...") { pos += 1; return { kind: "Vararg", line: token.line }; }
    return parseSuffixed();
  }

  function parsePrimary() {
    const token = peek();
    if (token.type === "name") { pos += 1; return { kind: "Name", name: token.value, line: token.line }; }
    if (token.type === "op" && token.value === "(") {
      pos += 1;
      const inner = parseExpr();
      expect("op", ")");
      // Parentheses truncate a multi-value expression to a single value.
      return { kind: "Paren", expr: inner, line: token.line };
    }
    fail(`unexpected "${token.value}"`);
  }

  function parseSuffixed() {
    let node = parsePrimary();
    for (;;) {
      const token = peek();
      if (token.type === "op" && token.value === ".") {
        pos += 1;
        const key = expect("name").value;
        node = { kind: "Index", object: node, key: { kind: "String", value: key, line: token.line }, line: token.line };
        continue;
      }
      if (token.type === "op" && token.value === "[") {
        pos += 1;
        const key = parseExpr();
        expect("op", "]");
        node = { kind: "Index", object: node, key, line: token.line };
        continue;
      }
      if (token.type === "op" && token.value === ":") {
        pos += 1;
        const method = expect("name").value;
        node = { kind: "MethodCall", object: node, method, args: parseCallArgs(), line: token.line };
        continue;
      }
      if ((token.type === "op" && (token.value === "(" || token.value === "{")) || token.type === "string") {
        node = { kind: "Call", callee: node, args: parseCallArgs(), line: token.line };
        continue;
      }
      return node;
    }
  }

  function parseCallArgs() {
    const token = peek();
    if (token.type === "string") { pos += 1; return [{ kind: "String", value: token.value, line: token.line }]; }
    if (token.type === "op" && token.value === "{") return [parseTable()];
    expect("op", "(");
    const args = [];
    if (!check("op", ")")) {
      args.push(parseExpr());
      while (accept("op", ",")) args.push(parseExpr());
    }
    expect("op", ")");
    return args;
  }

  function parseTable() {
    const { line } = expect("op", "{");
    const fields = [];
    while (!check("op", "}")) {
      if (accept("op", "[")) {
        const key = parseExpr();
        expect("op", "]");
        expect("op", "=");
        fields.push({ type: "keyed", key, value: parseExpr() });
      } else if (check("name") && peek(1).type === "op" && peek(1).value === "=") {
        const key = expect("name").value;
        expect("op", "=");
        fields.push({ type: "keyed", key: { kind: "String", value: key, line }, value: parseExpr() });
      } else {
        fields.push({ type: "positional", value: parseExpr() });
      }
      if (!accept("op", ",") && !accept("op", ";")) break;
    }
    expect("op", "}");
    return { kind: "Table", fields, line };
  }

  const body = parseBlock(new Set());
  if (peek().type !== "eof") fail(`unexpected "${peek().value}"`);
  return { kind: "Chunk", body, file };
}

// ----------------------------------------------------------- interpreter

const BREAK = Symbol("break");
const RETURN = Symbol("return");

class Scope {
  constructor(parent = null) {
    this.vars = new Map();
    this.parent = parent;
  }
  declare(name, value) { this.vars.set(name, value); }
  has(name) { return this.vars.has(name) || (this.parent !== null && this.parent.has(name)); }
  get(name) {
    if (this.vars.has(name)) return this.vars.get(name);
    return this.parent === null ? undefined : this.parent.get(name);
  }
  assign(name, value) {
    if (this.vars.has(name)) { this.vars.set(name, value); return true; }
    return this.parent === null ? false : this.parent.assign(name, value);
  }
}

// Everything a parsed chunk contains. A program without a loop cannot run more
// statements than this between two host calls, whatever its size, so it is the
// program's own measure of how far it may go while commanding nothing.
function nodeCount(node) {
  if (Array.isArray(node)) { let total = 0; for (const item of node) total += nodeCount(item); return total; }
  if (!node || typeof node !== "object") return 0;
  let total = typeof node.kind === "string" ? 1 : 0;
  for (const value of Object.values(node)) total += nodeCount(value);
  return total;
}

export class LuaRuntime {
  /**
   * @param {object} [options]
   * @param {Record<string, Function>} [options.host] functions the Lua may call.
   *   Each receives (args, context) where context is { file, line, name },
   *   and may return a single value or an array of Lua values.
   * A program is never stopped for being long: it is stopped when it stops
   * making progress. Calling the host is the only thing a program can do that
   * the reader can observe, so each host call clears the quiet-step count, and
   * a program that runs more statements between two host calls than the whole
   * loaded program contains is looping without commanding anything.
   */
  constructor({ host = {} } = {}) {
    this.globals = new Map();
    this.host = new Map(Object.entries(host));
    this.reach = 0;
    this.steps = 0;
    this.file = "<lua>";
    // Outermost-first. A host binding needs this to report the call site in
    // the plan body rather than the line inside whichever helper wrapped it.
    this.callStack = [];
  }

  /** Execute a chunk, leaving its globals in place for chunks loaded after it. */
  load(source, file = "<lua>") {
    const chunk = parse(source, file);
    this.reach += nodeCount(chunk);
    const previousFile = this.file;
    this.file = file;
    try {
      const signal = this.execBlock(chunk.body, new Scope(null));
      return signal && signal.type === RETURN ? signal.values : [];
    } finally {
      this.file = previousFile;
    }
  }

  /** Call a global Lua function by name, e.g. runtime.call("RunPlan"). */
  call(name, args = []) {
    const fn = this.globals.get(name);
    if (fn === undefined || fn === null) {
      throw new LuaSubsetError(`no global function named "${name}"`, { file: this.file });
    }
    return this.invoke(fn, args, { file: this.file, line: null, name });
  }

  // -- execution -------------------------------------------------------

  tick(line) {
    this.steps += 1;
    if (this.steps > this.reach) {
      throw new LuaSubsetError(
        `ran ${this.steps} steps without commanding the machine, more than the ${this.reach} the loaded program contains: it is looping without making progress`,
        { file: this.file, line }
      );
    }
  }

  execBlock(block, scope) {
    for (const statement of block.statements) {
      const signal = this.execStatement(statement, scope);
      if (signal) return signal;
    }
    return null;
  }

  execStatement(node, scope) {
    this.tick(node.line);
    switch (node.kind) {
      case "Local": {
        const values = this.evalList(node.values, scope, node.names.length);
        node.names.forEach((name, i) => scope.declare(name, values[i] ?? null));
        return null;
      }
      case "LocalFunction": {
        scope.declare(node.name, null); // declared first, so the body can recurse
        scope.declare(node.name, this.makeClosure(node.fn, scope));
        return null;
      }
      case "Assign": {
        const values = this.evalList(node.values, scope, node.targets.length);
        node.targets.forEach((target, i) => this.assign(target, values[i] ?? null, scope));
        return null;
      }
      case "CallStatement":
        this.evalCall(node.call, scope);
        return null;
      case "If": {
        for (const clause of node.clauses) {
          if (truthy(this.eval(clause.condition, scope))) return this.execBlock(clause.body, new Scope(scope));
        }
        return node.orelse ? this.execBlock(node.orelse, new Scope(scope)) : null;
      }
      case "While": {
        while (truthy(this.eval(node.condition, scope))) {
          this.tick(node.line);
          const signal = this.execBlock(node.body, new Scope(scope));
          if (signal) {
            if (signal.type === BREAK) break;
            return signal;
          }
        }
        return null;
      }
      case "Repeat": {
        for (;;) {
          this.tick(node.line);
          const inner = new Scope(scope);
          const signal = this.execBlock(node.body, inner);
          if (signal) {
            if (signal.type === BREAK) break;
            return signal;
          }
          if (truthy(this.eval(node.condition, inner))) break;
        }
        return null;
      }
      case "NumericFor": {
        const start = this.number(this.eval(node.start, scope), node);
        const limit = this.number(this.eval(node.limit, scope), node);
        const step = node.step === null ? 1 : this.number(this.eval(node.step, scope), node);
        if (step === 0) throw new LuaSubsetError("'for' step is zero", { file: this.file, line: node.line });
        for (let v = start; step > 0 ? v <= limit : v >= limit; v += step) {
          this.tick(node.line);
          const inner = new Scope(scope);
          inner.declare(node.name, v);
          const signal = this.execBlock(node.body, inner);
          if (signal) {
            if (signal.type === BREAK) break;
            return signal;
          }
        }
        return null;
      }
      case "GenericFor": {
        const [iterator] = this.evalList(node.exprs, scope, 1);
        if (!iterator || typeof iterator.__pairs !== "function") {
          throw new LuaSubsetError(
            "only ipairs(t) and pairs(t) are supported in a generic for",
            { file: this.file, line: node.line }
          );
        }
        for (const entry of iterator.__pairs()) {
          this.tick(node.line);
          const inner = new Scope(scope);
          node.names.forEach((name, i) => inner.declare(name, entry[i] ?? null));
          const signal = this.execBlock(node.body, inner);
          if (signal) {
            if (signal.type === BREAK) break;
            return signal;
          }
        }
        return null;
      }
      case "Do":
        return this.execBlock(node.body, new Scope(scope));
      case "Break":
        return { type: BREAK };
      case "Return":
        return { type: RETURN, values: this.evalList(node.values, scope, null) };
      default:
        throw new LuaSubsetError(`unsupported statement "${node.kind}"`, { file: this.file, line: node.line });
    }
  }

  assign(target, value, scope) {
    if (target.kind === "Name") {
      if (!scope.assign(target.name, value)) this.globals.set(target.name, value);
      return;
    }
    const object = this.eval(target.object, scope);
    if (!(object instanceof LuaTable)) {
      throw new LuaSubsetError(
        `attempt to index a ${luaTypeName(object)} value`,
        { file: this.file, line: target.line }
      );
    }
    object.set(this.eval(target.key, scope), value);
  }

  /** Evaluate an expression list. Only the last expression expands to many values. */
  evalList(nodes, scope, want) {
    const values = [];
    nodes.forEach((node, i) => {
      if (i === nodes.length - 1) values.push(...this.evalMulti(node, scope));
      else values.push(this.eval(node, scope));
    });
    if (want === null) return values;
    while (values.length < want) values.push(null);
    return values;
  }

  evalMulti(node, scope) {
    if (node.kind === "Call" || node.kind === "MethodCall") return this.evalCall(node, scope);
    if (node.kind === "Vararg") return [...(scope.get("...") ?? [])];
    return [this.eval(node, scope)];
  }

  eval(node, scope) {
    this.tick(node.line);
    switch (node.kind) {
      case "Number":
      case "String":
      case "Boolean":
        return node.value;
      case "Nil":
        return null;
      case "Vararg":
        return (scope.get("...") ?? [])[0] ?? null;
      case "Paren":
        return this.eval(node.expr, scope);
      case "Function":
        return this.makeClosure(node, scope);
      case "Name": {
        if (scope.has(node.name)) {
          const value = scope.get(node.name);
          return value === undefined ? null : value;
        }
        const global = this.globals.get(node.name);
        if (global !== undefined) return global;
        // Host entries are visible as values too, not only as call targets,
        // so that a library table can be indexed: math.cos(a).
        const hosted = this.host.get(node.name);
        return hosted === undefined ? null : hosted;
      }
      case "Index": {
        const object = this.eval(node.object, scope);
        if (!(object instanceof LuaTable)) {
          throw new LuaSubsetError(
            `attempt to index a ${luaTypeName(object)} value`,
            { file: this.file, line: node.line }
          );
        }
        return object.get(this.eval(node.key, scope));
      }
      case "Table": {
        const table = new LuaTable();
        let index = 1;
        node.fields.forEach((field, i) => {
          if (field.type === "keyed") {
            table.set(this.eval(field.key, scope), this.eval(field.value, scope));
            return;
          }
          const isLast = i === node.fields.length - 1;
          const values = isLast ? this.evalMulti(field.value, scope) : [this.eval(field.value, scope)];
          for (const value of values) table.set(index++, value);
        });
        return table;
      }
      case "Unary":
        return this.evalUnary(node, scope);
      case "Binary":
        return this.evalBinary(node, scope);
      case "Call":
      case "MethodCall": {
        const values = this.evalCall(node, scope);
        return values.length ? values[0] : null;
      }
      default:
        throw new LuaSubsetError(`unsupported expression "${node.kind}"`, { file: this.file, line: node.line });
    }
  }

  evalUnary(node, scope) {
    const value = this.eval(node.operand, scope);
    if (node.op === "not") return !truthy(value);
    if (node.op === "-") return -this.number(value, node);
    if (value instanceof LuaTable) return value.length;
    if (typeof value === "string") return value.length;
    throw new LuaSubsetError(
      `attempt to get the length of a ${luaTypeName(value)} value`,
      { file: this.file, line: node.line }
    );
  }

  evalBinary(node, scope) {
    const { op } = node;

    // Short-circuit before evaluating the right-hand side.
    if (op === "and") {
      const left = this.eval(node.left, scope);
      return truthy(left) ? this.eval(node.right, scope) : left;
    }
    if (op === "or") {
      const left = this.eval(node.left, scope);
      return truthy(left) ? left : this.eval(node.right, scope);
    }

    const a = this.eval(node.left, scope);
    const b = this.eval(node.right, scope);
    switch (op) {
      case "+": return this.number(a, node) + this.number(b, node);
      case "-": return this.number(a, node) - this.number(b, node);
      case "*": return this.number(a, node) * this.number(b, node);
      case "/": return this.number(a, node) / this.number(b, node);
      // Lua's modulo takes the sign of the divisor, unlike JavaScript's %.
      case "%": {
        const x = this.number(a, node);
        const y = this.number(b, node);
        return x - Math.floor(x / y) * y;
      }
      case "^": return this.number(a, node) ** this.number(b, node);
      case "..": return `${this.stringify(a, node)}${this.stringify(b, node)}`;
      case "==": return luaEquals(a, b);
      case "~=": return !luaEquals(a, b);
      case "<": return this.compare(a, b, node) < 0;
      case "<=": return this.compare(a, b, node) <= 0;
      case ">": return this.compare(a, b, node) > 0;
      case ">=": return this.compare(a, b, node) >= 0;
      default:
        throw new LuaSubsetError(`unsupported operator "${op}"`, { file: this.file, line: node.line });
    }
  }

  compare(a, b, node) {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
    throw new LuaSubsetError(
      `attempt to compare ${luaTypeName(a)} with ${luaTypeName(b)}`,
      { file: this.file, line: node.line }
    );
  }

  stringify(value, node) {
    if (typeof value === "string") return value;
    if (typeof value === "number") return formatLuaNumber(value);
    throw new LuaSubsetError(
      `attempt to concatenate a ${luaTypeName(value)} value`,
      { file: this.file, line: node.line }
    );
  }

  number(value, node) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
    throw new LuaSubsetError(
      `attempt to perform arithmetic on a ${luaTypeName(value)} value`,
      { file: this.file, line: node?.line }
    );
  }

  makeClosure(node, scope) {
    const runtime = this;
    // A function's source file is where it was defined, not where it is
    // called from. Without this, every frame raised from inside a helper
    // would be attributed to whichever chunk happened to be loading last.
    const definedIn = this.file;
    return {
      __luaFunction: true,
      name: node.name,
      file: definedIn,
      call(args) {
        const inner = new Scope(scope);
        node.params.forEach((param, i) => inner.declare(param, args[i] ?? null));
        if (node.isVararg) inner.declare("...", args.slice(node.params.length));
        const previousFile = runtime.file;
        runtime.file = definedIn;
        try {
          const signal = runtime.execBlock(node.body, inner);
          return signal && signal.type === RETURN ? signal.values : [];
        } finally {
          runtime.file = previousFile;
        }
      },
    };
  }

  evalCall(node, scope) {
    if (node.kind === "MethodCall") {
      throw new LuaSubsetError(
        "method calls are not supported by the Lua subset reader",
        { file: this.file, line: node.line }
      );
    }

    const args = this.evalList(node.args, scope, null);
    const context = { file: this.file, line: node.line, name: calleeName(node.callee) };

    if (node.callee.kind === "Name") {
      const name = node.callee.name;
      const defined = scope.has(name) ? scope.get(name) : this.globals.get(name);
      // Lua code that defines a function of the same name wins over a host
      // binding, so a project can wrap a controller primitive in its own Lua.
      if (defined === undefined || defined === null) {
        const hostFn = this.host.get(name);
        // Host bindings enter through the same invocation step as Lua values, so
        // one path covers every call and a non-callable host entry is refused
        // rather than crashing.
        if (hostFn) { this.steps = 0; return this.invoke(hostFn, args, context); }
        throw new LuaSubsetError(
          `call to unknown function "${name}" — the reader will not guess what it does`,
          { file: this.file, line: node.line }
        );
      }
      return this.invoke(defined, args, context);
    }

    return this.invoke(this.eval(node.callee, scope), args, context);
  }

  invoke(callee, args, context) {
    if (callee && callee.__luaFunction) {
      return this.enter(context, () => normalizeReturn(callee.call(args, context)));
    }
    if (typeof callee === "function") {
      return this.enter(context, () => normalizeReturn(callee(args, this.contextWithStack(context))));
    }
    throw new LuaSubsetError(
      `attempt to call a ${luaTypeName(callee)} value`,
      { file: context.file, line: context.line }
    );
  }

  enter(frame, run) {
    this.callStack.push({ file: frame.file ?? null, line: frame.line ?? null, call: frame.name ?? null });
    try {
      return run();
    } finally {
      this.callStack.pop();
    }
  }

  contextWithStack(context) {
    return { ...context, stack: this.callStack.map((frame) => ({ ...frame })) };
  }
}

function normalizeReturn(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function calleeName(node) {
  if (node.kind === "Name") return node.name;
  if (node.kind === "Index" && node.key.kind === "String") return `${calleeName(node.object)}.${node.key.value}`;
  return "<expression>";
}

export function truthy(value) {
  return value !== null && value !== false && value !== undefined;
}

export function luaTypeName(value) {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof LuaTable) return "table";
  return "function";
}

function luaEquals(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  return a === b;
}

export function formatLuaNumber(value) {
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

/** The standard-library subset generated Lua is allowed to rely on. */
export function standardLibrary() {
  return {
    ipairs: ([table]) => {
      if (!(table instanceof LuaTable)) throw new LuaSubsetError("ipairs expects a table");
      return [{ __pairs: () => table.toArray().map((value, i) => [i + 1, value]) }];
    },
    pairs: ([table]) => {
      if (!(table instanceof LuaTable)) throw new LuaSubsetError("pairs expects a table");
      return [{ __pairs: () => [...table.map.entries()] }];
    },
    tonumber: ([value]) => {
      if (typeof value === "number") return [value];
      const n = Number(String(value ?? "").trim());
      return [Number.isFinite(n) ? n : null];
    },
    tostring: ([value]) => [
      typeof value === "number" ? formatLuaNumber(value) : value === null ? "nil" : String(value),
    ],
    type: ([value]) => [luaTypeName(value)],
    math: LuaTable.from([
      ["pi", Math.PI],
      ["huge", Infinity],
      ["abs", ([x]) => [Math.abs(x)]],
      ["floor", ([x]) => [Math.floor(x)]],
      ["ceil", ([x]) => [Math.ceil(x)]],
      ["sqrt", ([x]) => [Math.sqrt(x)]],
      ["sin", ([x]) => [Math.sin(x)]],
      ["cos", ([x]) => [Math.cos(x)]],
      ["tan", ([x]) => [Math.tan(x)]],
      ["atan", ([y, x]) => [x === undefined || x === null ? Math.atan(y) : Math.atan2(y, x)]],
      ["max", (xs) => [Math.max(...xs)]],
      ["min", (xs) => [Math.min(...xs)]],
      ["rad", ([x]) => [(x * Math.PI) / 180]],
      ["deg", ([x]) => [(x * 180) / Math.PI]],
      ["fmod", ([x, y]) => [x % y]],
    ]),
  };
}
