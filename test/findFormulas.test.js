const test = require('node:test');
const assert = require('node:assert');
const { findFormulas } = require('../src/evaluate.js');

test('finds several formulas with offsets', () => {
  const text = 'a =(1+2) b =(3)';
  assert.deepStrictEqual(findFormulas(text), [
    { from: 2, to: 8, expr: '1+2', name: null },
    { from: 11, to: 15, expr: '3', name: null },
  ]);
  assert.strictEqual(text.slice(2, 8), '=(1+2)');
});

test('nested parentheses', () => {
  assert.deepStrictEqual(findFormulas('x =(2*(3+4)) y'), [{ from: 2, to: 12, expr: '2*(3+4)', name: null }]);
});

test('unbalanced is ignored', () => {
  assert.deepStrictEqual(findFormulas('=(1+1'), []);
  assert.deepStrictEqual(findFormulas('=(1+1 et =(2)'), [{ from: 9, to: 13, expr: '2', name: null }]);
});

test('#name suffix', () => {
  assert.deepStrictEqual(findFormulas('a =(4*5)#prix b'), [{ from: 2, to: 13, expr: '4*5', name: 'prix' }]);
  assert.deepStrictEqual(findFormulas('=(1)#'), [{ from: 0, to: 4, expr: '1', name: null }]);
  assert.deepStrictEqual(findFormulas('=(1)#1'), [{ from: 0, to: 4, expr: '1', name: null }]);
  assert.deepStrictEqual(findFormulas('=(1)#ab2'), [{ from: 0, to: 7, expr: '1', name: 'ab' }]);
  assert.deepStrictEqual(findFormulas('=(1) #a'), [{ from: 0, to: 4, expr: '1', name: null }]);
});
