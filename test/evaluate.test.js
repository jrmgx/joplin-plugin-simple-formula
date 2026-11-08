const test = require('node:test');
const assert = require('node:assert');
const { evaluate } = require('../src/evaluate.js');

const ok = (expr, value) => {
  const r = evaluate(expr);
  assert.deepStrictEqual({ ok: r.ok, value: r.value, error: r.error }, { ok: true, value, error: undefined }, expr);
};
const ko = (expr, pattern) => {
  const r = evaluate(expr);
  assert.strictEqual(r.ok, false, `${expr} should fail`);
  if (pattern) assert.match(r.error, pattern);
};

test('arithmetic', () => {
  ok('4*5', '20');
  ok('6+4', '10');
  ok('2*(3+4)', '14');
  ok('10/4', '2.5');
  ok('10 % 3', '1');
  ok('2**3', '8');
  ok('-3 + 1', '-2');
  ok('1e3', '1000');
  ok('2**3**2', '512');
  ok('-2**2', '-4');
  ok('2**-1', '0.5');
  ok('.5*2', '1');
  ok('8 - 2 - 1', '5');
  ok('100 / 10 / 2', '5');
});

test('float rounding', () => {
  ok('0.1+0.2', '0.3');
});

test('Math functions and constants', () => {
  ok('sqrt(16)', '4');
  ok('max(1, 5)', '5');
  ok('round(PI)', '3.14');
  ok('tan(PI/4)', '1');
  ok('E', '2.71828182846');
  ok('hypot(3, 4)', '5');
});

test('round with decimals (default 2)', () => {
  ok('round(12.1234)', '12.12');
  ok('round(12.1234, 0)', '12');
  ok('round(12.1234, 3)', '12.123');
  ok('round(12.5, 0)', '13');
  ok('round(-2.5, 0)', '-3');
  ok('round(1.005)', '1.01');
  ok('round(1234.5, -2)', '1200');
  ok('round(10/3, 1+1)', '3.33');
  ok('round(5)', '5');
});

test('errors', () => {
  ko('round(1.5, 0.5)', /decimals must be an integer/);
  ko('round(1, 2, 3)', /at most 2 arguments/);
  ko('1/0', /Division by zero/);
  ko('min()', /Division by zero or overflow/);
  ko('alert(1)', /Unknown identifier "alert"/);
  ko('PI.constructor', /Forbidden character '\.'/);
  ko('PI(2)', /"PI" is not a function/);
  ko('Math.PI', /Unknown identifier "Math"/);
  ko('2^3', /Forbidden character/);
  ko('"a"', /Forbidden character/);
  ko('1 +', /Unexpected end of expression/);
  ko('1 2', /Unexpected token '2'/);
  ko('', /Unexpected end/);
  ko('sqrt', /not a number/);
  ko('sqrt(-1)', /NaN/);
});

test('no eval / new Function (Joplin CSP forbids unsafe-eval)', () => {
  for (const f of ['evaluate.js', 'markdownItFormula.js', 'codeMirrorFormula.js']) {
    const src = require('node:fs').readFileSync(require.resolve(`../src/${f}`), 'utf8')
      .replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\beval\s*\(|new\s+Function/, f);
  }
});
