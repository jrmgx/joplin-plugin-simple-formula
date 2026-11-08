// Shared formula logic: safe expression evaluator + formula finder.
// No eval/new Function: Joplin's Content Security Policy forbids 'unsafe-eval',
// so expressions are parsed and evaluated by a small recursive-descent parser.
// Inlined into each content script by scripts/build.js.

// round(x, decimals = 2): rounds to a number of decimals (replaces Math.round).
// Uses exponent notation to avoid float errors (round(1.005) = 1.01), and rounds
// half away from zero (round(-2.5, 0) = -3).
function round(x, decimals = 2) {
  if (arguments.length > 2) throw new Error('round expects at most 2 arguments');
  if (!Number.isInteger(decimals)) throw new Error('round: decimals must be an integer');
  if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return x;
  const shifted = Math.round(Number(`${Math.abs(x)}e${decimals}`));
  return Math.sign(x) * Number(`${shifted}e${-decimals}`);
}

// Functions/constants usable in formulas: everything from Math, with custom overrides.
const FUNCTIONS = Object.create(null);
for (const name of Object.getOwnPropertyNames(Math)) FUNCTIONS[name] = Math[name];
FUNCTIONS.round = round;
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[A-Za-z_]\w*/;

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const rest = expr.slice(i);
    const ws = /^\s+/.exec(rest);
    if (ws) { i += ws[0].length; continue; }
    let m;
    if ((m = NUMBER.exec(rest))) {
      tokens.push({ type: 'num', value: parseFloat(m[0]), text: m[0] });
      i += m[0].length;
    } else if ((m = IDENT.exec(rest))) {
      tokens.push({ type: 'id', text: m[0] });
      i += m[0].length;
    } else if (rest.startsWith('**')) {
      tokens.push({ type: 'op', text: '**' });
      i += 2;
    } else if ('+-*/%(),'.includes(rest[0])) {
      tokens.push({ type: 'op', text: rest[0] });
      i += 1;
    } else {
      // Reported by the parser when reached, so earlier errors (e.g. unknown identifier) win.
      tokens.push({ type: 'bad', text: rest[0] });
      i += 1;
    }
  }
  return tokens;
}

// lookup(name) returns the value of a named formula, undefined if unknown, or throws.
function parse(tokens, lookup) {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (text) => peek() && peek().type === 'op' && peek().text === text;
  const unexpected = () => {
    const t = peek();
    if (!t) return new Error('Unexpected end of expression');
    if (t.type === 'bad') return new Error(`Forbidden character '${t.text}'`);
    return new Error(`Unexpected token '${t.text}'`);
  };
  const expect = (text) => {
    if (!isOp(text)) throw unexpected();
    pos++;
  };

  function additive() {
    let left = multiplicative();
    while (isOp('+') || isOp('-')) {
      const op = tokens[pos++].text;
      const right = multiplicative();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function multiplicative() {
    let left = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = tokens[pos++].text;
      const right = unary();
      if (op === '*') left *= right;
      else if (op === '/') left /= right;
      else left %= right;
    }
    return left;
  }

  function unary() {
    if (isOp('-')) { pos++; return -unary(); }
    if (isOp('+')) { pos++; return +unary(); }
    return power();
  }

  // Right-associative: 2**3**2 = 2**9
  function power() {
    const base = primary();
    if (isOp('**')) {
      pos++;
      return base ** unary();
    }
    return base;
  }

  function primary() {
    const t = peek();
    if (!t) throw unexpected();
    if (t.type === 'num') { pos++; return t.value; }
    if (t.type === 'id') {
      pos++;
      let member;
      if (t.text in FUNCTIONS) member = FUNCTIONS[t.text];
      else if (lookup) member = lookup(t.text);
      if (member === undefined) throw new Error(`Unknown identifier "${t.text}"`);
      if (isOp('(')) {
        pos++;
        if (typeof member !== 'function') throw new Error(`"${t.text}" is not a function`);
        const args = [];
        if (!isOp(')')) {
          args.push(additive());
          while (isOp(',')) { pos++; args.push(additive()); }
        }
        expect(')');
        return member(...args);
      }
      if (typeof member !== 'number') throw new Error(`"${t.text}" is not a number, use ${t.text}(...)`);
      return member;
    }
    if (isOp('(')) {
      pos++;
      const v = additive();
      expect(')');
      return v;
    }
    throw unexpected();
  }

  const result = additive();
  if (pos < tokens.length) throw unexpected();
  return result;
}

function formatNumber(n) {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(12)));
}

function errorResult(e) {
  const result = { ok: false, error: e && e.message ? e.message : String(e) };
  if (e && e.cycle) result.cycle = e.cycle;
  return result;
}

// Returns { ok: true, value (formatted string), number (exact) } or { ok: false, error }.
function evaluate(expr, lookup) {
  let result;
  try {
    result = parse(tokenize(expr), lookup);
  } catch (e) {
    return errorResult(e);
  }
  if (Number.isNaN(result)) {
    return { ok: false, error: 'Result is NaN' };
  }
  if (!Number.isFinite(result)) {
    return { ok: false, error: 'Division by zero or overflow' };
  }
  return { ok: true, value: formatNumber(result), number: result };
}

function cycleError(path) {
  const e = new Error(`Circular reference: ${path.join(' -> ')}`);
  e.cycle = path;
  return e;
}

// Resolves a whole note's formulas, so they can reference each other by name.
// formulas: [{ expr, name|null }]. Returns:
//   results[i]          result of formulas[i]
//   resultOf(expr,name) result of a formula found elsewhere (e.g. a rendered table cell)
function createScope(formulas) {
  const defs = new Map(); // name -> indices of its definitions
  formulas.forEach((f, i) => {
    if (!f.name) return;
    if (!defs.has(f.name)) defs.set(f.name, []);
    defs.get(f.name).push(i);
  });

  const memo = new Map(); // name -> result
  const stack = []; // names being evaluated, to detect cycles

  function nameResult(name) {
    if (memo.has(name)) return memo.get(name);
    const indices = defs.get(name);
    let result;
    if (name in FUNCTIONS) {
      result = { ok: false, error: `"${name}" is a reserved name` };
    } else if (indices.length > 1) {
      result = { ok: false, error: `Duplicate name "${name}"` };
    } else {
      stack.push(name);
      result = evaluate(formulas[indices[0]].expr, lookup);
      stack.pop();
    }
    memo.set(name, result);
    return result;
  }

  function lookup(name) {
    if (!defs.has(name)) return undefined;
    const inProgress = stack.indexOf(name);
    if (inProgress !== -1) throw cycleError([...stack.slice(inProgress), name]);
    const result = nameResult(name);
    if (result.ok) return result.number;
    // Formulas that are part of the cycle all report it; others just see a broken reference.
    const current = stack[stack.length - 1];
    if (result.cycle && current && result.cycle.includes(current)) throw cycleError(result.cycle);
    throw new Error(`Reference "${name}" has an error`);
  }

  function resultOf(expr, name) {
    if (name && defs.has(name)) return nameResult(name);
    return evaluate(expr, lookup);
  }

  const results = formulas.map((f) => resultOf(f.expr, f.name));
  return { results, resultOf };
}

// Index of the ")" closing the "(" at openIndex, or -1 if unbalanced before limit.
function findClosingParen(text, openIndex, limit = text.length) {
  let depth = 0;
  for (let i = openIndex; i < limit; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Optional "#name" suffix right after the closing ")": letters only.
const NAME_SUFFIX = /^#([A-Za-z]+)/;

function readName(text, afterClose) {
  const m = NAME_SUFFIX.exec(text.slice(afterClose, afterClose + 256));
  return m ? m[1] : null;
}

// All =(...)#name formulas in text: [{ from, to, expr, name|null }] (to is exclusive).
function findFormulas(text) {
  const found = [];
  let i = text.indexOf('=(');
  while (i !== -1) {
    const close = findClosingParen(text, i + 1);
    if (close === -1) {
      i = text.indexOf('=(', i + 1);
      continue;
    }
    const name = readName(text, close + 1);
    const to = close + 1 + (name ? name.length + 1 : 0);
    found.push({ from: i, to, expr: text.slice(i + 2, close), name });
    i = text.indexOf('=(', to);
  }
  return found;
}

module.exports = { evaluate, createScope, findClosingParen, findFormulas, readName };
