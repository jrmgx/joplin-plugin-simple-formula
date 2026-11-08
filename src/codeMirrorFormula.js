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

  // Markdown formatting around a formula, applied to its result: CodeMirror does not
  // reliably draw Joplin's bold/italic marks around a widget (e.g. "**=(x) bold**").
  const FORMAT_CLASSES = {
    StrongEmphasis: 'cm-simple-formula-strong',
    Emphasis: 'cm-simple-formula-em',
    Strikethrough: 'cm-simple-formula-strike',
  };

  function formatClasses(tree, pos) {
    const classes = new Set();
    for (let node = tree.resolveInner(pos, 1); node; node = node.parent) {
      if (FORMAT_CLASSES[node.name]) classes.add(FORMAT_CLASSES[node.name]);
    }
    return [...classes].sort().join(' ');
  }

  class FormulaWidget extends WidgetType {
    constructor(formula, format) {
      super();
      this.formula = formula;
      this.format = format;
    }

    eq(other) {
      const a = this.formula;
      const b = other.formula;
      return (
        this.format === other.format &&
        a.expr === b.expr &&
        a.name === b.name &&
        a.result.ok === b.result.ok &&
        a.result.value === b.result.value &&
        a.result.error === b.result.error
      );
    }

    toDOM() {
      const { expr, name, result } = this.formula;
      const span = fillSpan(document.createElement('span'), expr, name, result);
      if (this.format) span.className += ` ${this.format}`;
      return span;
    }

    // Let clicks reach the editor so the cursor lands on the line and reveals the formula.
    ignoreEvent() {
      return false;
    }
  }

  // On the line being edited the raw formula is shown, but Markdown parses e.g. a*1*2
  // as emphasis: Joplin then hides the "*" (class cm-hidden) and italicizes the text.
  // This mark covers the raw formula so the theme below can undo that formatting
  // (it may end up inside or around Joplin's marks, both cases are handled).
  const rawMark = Decoration.mark({ class: 'cm-simple-formula-raw' });

  function buildDecorations(view) {
    const { state } = view;
    const doc = state.doc;
    const { byPos } = state.field(scopeField);
    const tree = syntaxTree(state);

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
        const active = activeLines.has(line.number);
        for (const f of findFormulas(line.text)) {
          const formula = byPos.get(line.from + f.from);
          if (!formula) continue; // in code
          decorations.push(
            active
              ? rawMark.range(formula.from, formula.to)
              : Decoration.replace({ widget: new FormulaWidget(formula, formatClasses(tree, formula.from)) }).range(formula.from, formula.to)
          );
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
  // and offer no hook. That renderer also eats "*" inside formulas (=(2 * 3 * 4) has
  // "* 3 *" in italics), so cells holding formulas are rendered again from their
  // source, with the same rules as Joplin but formulas set aside first.
  // Cells being edited carry "cm-tw-raw" and are left alone (raw formula shown);
  // Joplin reads cell content only from those raw cells, so the note is never touched.
  const TABLE_CELL = '.cm-tw-text:not(.cm-tw-raw)';
  const RENDERED = '.cm-simple-formula, .cm-simple-formula-error';

  // Joplin's row splitting (tableUtils.ts): outer pipes dropped, unescaped "|" splits.
  function isUnescapedPipe(text, i) {
    if (text[i] !== '|') return false;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) backslashes++;
    return backslashes % 2 === 0;
  }

  function splitRow(line) {
    let trimmed = line.trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.length > 0 && isUnescapedPipe(trimmed, trimmed.length - 1)) trimmed = trimmed.slice(0, -1);
    const cells = [];
    let current = '';
    for (let i = 0; i < trimmed.length; i++) {
      if (isUnescapedPipe(trimmed, i)) {
        cells.push(current.trim());
        current = '';
      } else {
        current += trimmed[i];
      }
    }
    cells.push(current.trim());
    return cells;
  }

  // Markdown source of a rendered cell, or null if it cannot be found.
  function cellSource(view, textDiv) {
    const container = textDiv.closest('[data-from][data-to]');
    const td = textDiv.closest('td, th');
    const tr = td && td.closest('tr');
    if (!container || !tr) return null;
    const from = Number(container.dataset.from);
    const to = Number(container.dataset.to);
    if (!(from >= 0 && to <= view.state.doc.length && from < to)) return null;
    const lines = view.state.doc.sliceString(from, to).split('\n').filter((l) => l.trim().length > 0);
    const rows = [...container.querySelectorAll('tr')].filter((r) => r.querySelector('.cm-tw-text'));
    const rowIndex = rows.indexOf(tr);
    const colIndex = [...tr.children].filter((c) => c.querySelector('.cm-tw-text')).indexOf(td);
    if (rowIndex < 0 || colIndex < 0) return null;
    const line = lines[rowIndex === 0 ? 0 : rowIndex + 1]; // skip the delimiter row
    if (line === undefined) return null;
    const cell = splitRow(line)[colIndex];
    return cell === undefined ? null : cell.replace(/\\\|/g, '|');
  }

  // Same syntax as Joplin's inlineMarkdownToHtml (renderTables.ts).
  const INLINE = /\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|(?<![A-Za-z0-9])\*([^*]+)\*(?![A-Za-z0-9])|(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])|`([^`]+)`|~~([\s\S]+?)~~|\[([^\]]*)\]\(([^)\s]+)\)/g;
  const SAFE_HREF = /^(https?:|mailto:|:\/|joplin:|#)/i;
  const PLACEHOLDER_BASE = 0xe000; // private use area: never Markdown syntax
  const PLACEHOLDER = /[-]/g;

  // Renders a cell's source with each formula replaced by its result.
  function renderCell(textDiv, source, scope) {
    const doc = textDiv.ownerDocument;
    const formulas = findFormulas(source);
    let marked = '';
    let last = 0;
    formulas.forEach((f, i) => {
      marked += source.slice(last, f.from) + String.fromCharCode(PLACEHOLDER_BASE + i);
      last = f.to;
    });
    marked += source.slice(last);
    const restore = (text) =>
      text.replace(PLACEHOLDER, (c) => {
        const f = formulas[c.charCodeAt(0) - PLACEHOLDER_BASE];
        return f ? source.slice(f.from, f.to) : c;
      });

    function appendText(parent, text) {
      let start = 0;
      for (const m of text.matchAll(PLACEHOLDER)) {
        const f = formulas[m[0].charCodeAt(0) - PLACEHOLDER_BASE];
        if (!f) continue;
        if (m.index > start) parent.appendChild(doc.createTextNode(text.slice(start, m.index)));
        parent.appendChild(fillSpan(doc.createElement('span'), f.expr, f.name, scope.resultOf(f.expr, f.name)));
        start = m.index + 1;
      }
      if (start < text.length) parent.appendChild(doc.createTextNode(text.slice(start)));
    }

    function render(parent, segment) {
      const re = new RegExp(INLINE.source, 'g');
      let lastIdx = 0;
      let m;
      while ((m = re.exec(segment)) !== null) {
        if (m.index > lastIdx) appendText(parent, segment.slice(lastIdx, m.index));
        let el;
        if (m[1] !== undefined || m[2] !== undefined) {
          el = doc.createElement('strong');
          render(el, m[1] !== undefined ? m[1] : m[2]);
        } else if (m[3] !== undefined || m[4] !== undefined) {
          el = doc.createElement('em');
          render(el, m[3] !== undefined ? m[3] : m[4]);
        } else if (m[5] !== undefined) {
          el = doc.createElement('code');
          el.textContent = restore(m[5]); // code is literal: formulas are not computed
        } else if (m[6] !== undefined) {
          el = doc.createElement('del');
          render(el, m[6]);
        } else {
          el = doc.createElement('a');
          const href = restore(m[8]);
          if (SAFE_HREF.test(href)) el.setAttribute('href', href);
          render(el, m[7]);
        }
        parent.appendChild(el);
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx < segment.length) appendText(parent, segment.slice(lastIdx));
    }

    textDiv.textContent = '';
    marked.split(/<br\s*\/?>/i).forEach((segment, i) => {
      if (i > 0) textDiv.appendChild(doc.createElement('br'));
      render(textDiv, segment);
    });
  }

  // Fallback when the cell source is unknown: replace formulas found in text nodes.
  function renderFormulasInTextNodes(cell, scope) {
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

  function renderFormulasInCell(view, cell, scope) {
    const source = cellSource(view, cell);
    if (source === null) {
      renderFormulasInTextNodes(cell, scope);
      return;
    }
    if (!source.includes('=(') || findFormulas(source).length === 0) return;
    // Skip when already rendered from this source with the same results.
    const key = source + '\u0000' + findFormulas(source)
      .map((f) => {
        const r = scope.resultOf(f.expr, f.name);
        return r.ok ? r.value : `!${r.error}`;
      })
      .join('\u0000');
    if (cell.dataset.simpleFormula === key && cell.querySelector(RENDERED)) return;
    renderCell(cell, source, scope);
    cell.dataset.simpleFormula = key;
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
        for (const cell of this.view.dom.querySelectorAll(TABLE_CELL)) renderFormulasInCell(this.view, cell, scope);
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
    '.cm-simple-formula-raw, .cm-simple-formula-raw *': {
      fontStyle: 'normal !important',
      fontWeight: 'inherit !important',
      textDecoration: 'none !important',
    },
    '.cm-simple-formula-raw .cm-hidden, .cm-hidden:has(> .cm-simple-formula-raw)': {
      width: 'auto !important',
      height: 'auto !important',
      marginRight: '0 !important',
      opacity: '1 !important',
      display: 'inline !important',
      overflow: 'visible !important',
      transform: 'none !important',
    },
    '.cm-simple-formula-strong': { fontWeight: 'bold' },
    '.cm-simple-formula-em': { fontStyle: 'italic' },
    '.cm-simple-formula-strike': { textDecoration: 'line-through' },
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
