// Joplin markdown-it content script: renders =(expr) as its computed value in the viewer.
// =(expr)#name names a formula so others can reference it: =(name*2).

const { createScope, findClosingParen, readName } = require('./evaluate.js');

function formulaRule(state, silent) {
  const src = state.src;
  const start = state.pos;
  // "=" followed by "("
  if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x28) return false;

  const close = findClosingParen(src, start + 1, state.posMax);
  if (close === -1) return false;

  const name = readName(src.slice(0, state.posMax), close + 1);
  if (!silent) {
    const token = state.push('simple_formula', '', 0);
    token.content = src.slice(start + 2, close);
    token.meta = { expr: token.content, name };
  }
  state.pos = close + 1 + (name ? name.length + 1 : 0);
  return true;
}

function collectFormulaTokens(tokens, out) {
  for (const token of tokens) {
    if (token.type === 'simple_formula') out.push(token);
    if (token.children) collectFormulaTokens(token.children, out);
  }
  return out;
}

// Runs once the whole note is parsed: resolves every formula against the others.
function scopeRule(state) {
  const formulaTokens = collectFormulaTokens(state.tokens, []);
  if (formulaTokens.length === 0) return;
  const { results } = createScope(formulaTokens.map((t) => t.meta));
  formulaTokens.forEach((t, i) => {
    t.meta.result = results[i];
  });
}

function plugin(md) {
  md.inline.ruler.before('emphasis', 'simple_formula', formulaRule);
  md.core.ruler.push('simple_formula_scope', scopeRule);
  md.renderer.rules.simple_formula = (tokens, idx) => {
    const { expr, name, result } = tokens[idx].meta;
    const esc = md.utils.escapeHtml;
    const title = esc(`=(${expr})${name ? `#${name}` : ''}`);
    if (result.ok) {
      return `<span class="simple-formula" title="${title}">${esc(result.value)}</span>`;
    }
    return `<span class="simple-formula-error" title="${title}">error: ${esc(result.error)}</span>`;
  };
}

module.exports = {
  default: function () {
    return {
      plugin,
      assets: function () {
        return [{ name: 'style.css' }];
      },
    };
  },
  plugin,
};
