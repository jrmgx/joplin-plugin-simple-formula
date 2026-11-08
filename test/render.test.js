const test = require('node:test');
const assert = require('node:assert');
const MarkdownIt = require('markdown-it');
const contentScript = require('../src/markdownItFormula.js');

const md = new MarkdownIt();
contentScript.default({}).plugin(md, {});
const render = (s) => md.renderInline(s);

test('renders result', () => {
  assert.strictEqual(
    render('Total : =(4*5) €'),
    'Total : <span class="simple-formula" title="=(4*5)">20</span> €'
  );
});

test('* is not treated as emphasis', () => {
  assert.match(render('*a* =(2*3) et =(4*5)'), /<em>a<\/em> <span[^>]*>6<\/span> et <span[^>]*>20<\/span>/);
});

test('nested parentheses', () => {
  assert.match(render('=(2*(3+4))'), />14</);
});

test('error display', () => {
  assert.strictEqual(
    render('=(1/0)'),
    '<span class="simple-formula-error" title="=(1/0)">error: Division by zero or overflow</span>'
  );
  assert.match(render('=(alert(1))'), /error: Unknown identifier &quot;alert&quot;/);
});

test('inline code is left untouched', () => {
  assert.strictEqual(render('`=(1+1)`'), '<code>=(1+1)</code>');
});

test('unbalanced is left as text', () => {
  assert.strictEqual(render('=(1+1'), '=(1+1');
});

test('references across the whole note (preview)', () => {
  const html = md.render(
    'TTC =(prix*1.2)\n\n| a | b |\n|---|---|\n| HT | =(4*5)#prix |\n\n`=(1)#z` =(z)\n\n=(x)#x'
  );
  assert.match(html, /<span class="simple-formula" title="=\(prix\*1.2\)">24<\/span>/);
  assert.match(html, /<td><span class="simple-formula" title="=\(4\*5\)#prix">20<\/span><\/td>/);
  assert.match(html, /error: Unknown identifier &quot;z&quot;/);
  assert.match(html, /error: Circular reference: x -&gt; x/);
});
