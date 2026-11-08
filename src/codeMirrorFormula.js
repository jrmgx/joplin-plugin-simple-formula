// Joplin CodeMirror 6 content script: live rendering of =(expr) in the Markdown editor.
// On every line except those touched by the cursor/selection, =(9*9) is displayed as 81.
// Formulas named with =(expr)#name can be referenced anywhere in the note: =(name*2).
// Purely visual (decorations): the note text is never modified.

const { createScope, findFormulas } = require('./evaluate.js');

// CodeMirror packages are provided by Joplin at runtime (same instances as the editor).
function cmRequire(name) {
  /* global joplin */
  if (typeof require === 'function') {
    try {
      return require(name);
    } catch (e) {
      // fall through to joplin.require
    }
  }
  return joplin.require(name);
}

const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'HTMLBlock']);

function formulaTitle(expr, name) {
  return `=(${expr})${name ? `#${name}` : ''}`;
}

// Fills a span with a formula result (shared by editor widgets and table cells).
function fillSpan(span, expr, name, result) {
  span.className = result.ok ? 'cm-simple-formula' : 'cm-simple-formula-error';
  span.title = formulaTitle(expr, name);
  span.textContent = result.ok ? result.value : `error: ${result.error}`;
  span.dataset.expr = expr;
  if (name) span.dataset.name = name;
  return span;
}

function createExtension() {
  const { Decoration, EditorView, ViewPlugin, WidgetType } = cmRequire('@codemirror/view');
  const { StateField } = cmRequire('@codemirror/state');
  const { syntaxTree } = cmRequire('@codemirror/language');

  function isInCode(tree, pos) {
    for (let node = tree.resolveInner(pos, 1); node; node = node.parent) {
      if (CODE_NODES.has(node.name)) return true;
    }
    return false;
  }

  // Every formula of the whole document (outside code), resolved together so that
  // references work even to formulas outside the visible area.
  function computeScope(state) {
    const doc = state.doc;
    const tree = syntaxTree(state);
    const formulas = [];
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (!line.text.includes('=(')) continue;
      for (const f of findFormulas(line.text)) {
        const from = line.from + f.from;
        if (isInCode(tree, from)) continue;
        formulas.push({ from, to: line.from + f.to, expr: f.expr, name: f.name });
      }
    }
    const scope = createScope(formulas);
    const byPos = new Map();
    formulas.forEach((f, i) => byPos.set(f.from, { ...f, result: scope.results[i] }));
    return { byPos, resultOf: scope.resultOf };
  }

  const scopeField = StateField.define({
    create: computeScope,
    update(value, tr) {
      if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return computeScope(tr.state);
      }
      return value;
    },
  });

  class FormulaWidget extends WidgetType {
    constructor(formula) {
      super();
      this.formula = formula;
    }

    eq(other) {
      const a = this.formula;
      const b = other.formula;
      return (
        a.expr === b.expr &&
        a.name === b.name &&
        a.result.ok === b.result.ok &&
        a.result.value === b.result.value &&
        a.result.error === b.result.error
      );
    }

    toDOM() {
      const { expr, name, result } = this.formula;
      return fillSpan(document.createElement('span'), expr, name, result);
    }

    // Let clicks reach the editor so the cursor lands on the line and reveals the formula.
    ignoreEvent() {
      return false;
    }
  }

  function buildDecorations(view) {
    const { state } = view;
    const doc = state.doc;
    const { byPos } = state.field(scopeField);

    const activeLines = new Set();
    for (const range of state.selection.ranges) {
      const first = doc.lineAt(range.from).number;
      const last = doc.lineAt(range.to).number;
      for (let n = first; n <= last; n++) activeLines.add(n);
    }

    const decorations = [];
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = doc.lineAt(pos);
        if (!activeLines.has(line.number)) {
          for (const f of findFormulas(line.text)) {
            const formula = byPos.get(line.from + f.from);
            if (!formula) continue; // in code
            decorations.push(
              Decoration.replace({ widget: new FormulaWidget(formula) }).range(formula.from, formula.to)
            );
          }
        }
        pos = line.to + 1;
      }
    }
    return Decoration.set(decorations, true);
  }

  const formulaPlugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view);
      }

      update(update) {
        if (
          update.viewportChanged ||
          update.selectionSet ||
          update.startState.field(scopeField) !== update.state.field(scopeField)
        ) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );

  // Joplin renders Markdown tables as its own widget (class "cm-tw-*"), which hides
  // the decorations above. Its cells are rendered with a hard-coded inline renderer
  // and offer no hook, so formulas are replaced in the rendered cell DOM instead.
  // Cells being edited carry "cm-tw-raw" and are left alone (raw formula shown);
  // Joplin reads cell content only from those raw cells, so the note is never touched.
  const TABLE_CELL = '.cm-tw-text:not(.cm-tw-raw)';
  const RENDERED = '.cm-simple-formula, .cm-simple-formula-error';

  function renderFormulasInCell(cell, scope) {
    // Already rendered formulas: refresh (a referenced value may have changed).
    for (const span of cell.querySelectorAll(RENDERED)) {
      const { expr, name } = span.dataset;
      if (expr !== undefined) fillSpan(span, expr, name, scope.resultOf(expr, name));
    }

    const doc = cell.ownerDocument;
    const walker = doc.createTreeWalker(cell, 4 /* NodeFilter.SHOW_TEXT */);
    const textNodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement && n.parentElement.closest(`code, ${RENDERED}`)) continue;
      if (n.nodeValue.includes('=(')) textNodes.push(n);
    }
    for (const node of textNodes) {
      const text = node.nodeValue;
      const formulas = findFormulas(text);
      if (formulas.length === 0) continue;
      const frag = doc.createDocumentFragment();
      let last = 0;
      for (const f of formulas) {
        if (f.from > last) frag.appendChild(doc.createTextNode(text.slice(last, f.from)));
        frag.appendChild(fillSpan(doc.createElement('span'), f.expr, f.name, scope.resultOf(f.expr, f.name)));
        last = f.to;
      }
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  const tableCellPlugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        const win = view.dom.ownerDocument.defaultView;
        this.observer = new win.MutationObserver(() => this.process());
        this.process();
      }

      update(update) {
        if (update.startState.field(scopeField) !== update.state.field(scopeField)) this.process();
      }

      process() {
        // Pause observation while we edit the DOM, to avoid reacting to our own changes.
        this.observer.disconnect();
        const scope = this.view.state.field(scopeField);
        for (const cell of this.view.dom.querySelectorAll(TABLE_CELL)) renderFormulasInCell(cell, scope);
        this.observer.observe(this.view.dom, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['class'],
        });
      }

      destroy() {
        this.observer.disconnect();
      }
    }
  );

  const theme = EditorView.baseTheme({
    '.cm-simple-formula': {
      borderBottom: '1px dotted currentColor',
    },
    '.cm-simple-formula-error': {
      color: '#d32f2f',
      fontFamily: 'monospace',
    },
  });

  return [scopeField, formulaPlugin, tableCellPlugin, theme];
}

module.exports = {
  default: function () {
    return {
      plugin: function (codeMirrorWrapper) {
        // Only for the CodeMirror 6 editor (legacy CM5 editor: do nothing).
        if (!codeMirrorWrapper.cm6) return;
        codeMirrorWrapper.addExtension(createExtension());
      },
    };
  },
};
