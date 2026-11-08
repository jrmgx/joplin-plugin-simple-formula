const test = require('node:test');
const assert = require('node:assert');
const { createScope } = require('../src/evaluate.js');

// Each formula: "expr" or "expr#name". Returns displayed values / "error: ...".
const run = (...formulas) =>
  createScope(
    formulas.map((f) => {
      const [expr, name] = f.split('#');
      return { expr, name: name || null };
    })
  ).results.map((r) => (r.ok ? r.value : `error: ${r.error}`));

test('simple and forward references', () => {
  assert.deepStrictEqual(run('4*5#prix', 'prix*1.2'), ['20', '24']);
  assert.deepStrictEqual(run('prix*1.2', '4*5#prix'), ['24', '20']);
});

test('names with digits', () => {
  assert.deepStrictEqual(run('2#a1', '3#a2', 'a1*a2+1'), ['2', '3', '7']);
});

test('chained references', () => {
  assert.deepStrictEqual(run('c+1#b', 'b*2', '1#c'), ['2', '4', '1']);
});

test('references use the exact value, not the rounded display', () => {
  assert.deepStrictEqual(run('10/3#t', 't*3'), ['3.33333333333', '10']);
});

test('cycles', () => {
  assert.deepStrictEqual(run('x#x'), ['error: Circular reference: x -> x']);
  assert.deepStrictEqual(run('b#a', 'a#b', 'a'), [
    'error: Circular reference: a -> b -> a',
    'error: Circular reference: a -> b -> a',
    'error: Reference "a" has an error',
  ]);
});

test('duplicate and reserved names', () => {
  assert.deepStrictEqual(run('1#d', '2#d', 'd'), [
    'error: Duplicate name "d"',
    'error: Duplicate name "d"',
    'error: Reference "d" has an error',
  ]);
  assert.deepStrictEqual(run('1#PI', 'PI'), ['error: "PI" is a reserved name', '3.14159265359']);
});

test('unknown, broken and case-sensitive references', () => {
  assert.deepStrictEqual(run('foo'), ['error: Unknown identifier "foo"']);
  assert.deepStrictEqual(run('1/0#z', 'z+1'), [
    'error: Division by zero or overflow',
    'error: Reference "z" has an error',
  ]);
  assert.deepStrictEqual(run('1#prix', 'Prix'), ['1', 'error: Unknown identifier "Prix"']);
  assert.deepStrictEqual(run('2#a', 'a(1)'), ['2', 'error: "a" is not a function']);
});

test('resultOf (table cells)', () => {
  const scope = createScope([{ expr: '4*5', name: 'prix' }, { expr: 'prix*2', name: null }]);
  assert.strictEqual(scope.resultOf('prix*2', null).value, '40');
  assert.strictEqual(scope.resultOf('4*5', 'prix').value, '20');
});
