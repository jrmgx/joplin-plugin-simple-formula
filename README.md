# Simple Formula for Joplin

Inline calculations in your Joplin notes. Write a formula, see its result.

```
Price excl. tax: =(4*5)#price
VAT:             =(price*0.2)#vat
Total:           =(price+vat)
```

This displays as:

```
Price excl. tax: 20
VAT:             4
Total:           24
```

Results are only displayed: the text of your note is never changed and always keeps `=(4*5)`.

## Features

- **Live rendering in the Markdown editor.** Formulas show their result as soon as the cursor leaves the line. Move back to the line, or click a result, to see and edit the formula again.
- **Preview.** Formulas are computed in the rendered note too.
- **Tables.** Formulas work inside Markdown tables, both in the editor and in the preview.
- **Math functions.** All of JavaScript's `Math` is available, without the `Math.` prefix: `sqrt`, `max`, `PI`…
- **Named formulas.** Name a result with `#name` and reuse it in any other formula of the note.
- **Clear errors.** An invalid formula shows `error: <message>` instead of a result.

## Syntax

`=(expression)`

| Formula                 | Result |
|-------------------------|--------|
| `=(4*5)`                | 20     |
| `=(6+4)`                | 10     |
| `=(2*(3+4))`            | 14     |
| `=(10/4)`               | 2.5    |
| `=(10 % 3)`             | 1      |
| `=(2**3)`               | 8      |
| `=(0.1+0.2)`            | 0.3    |
| `=(sqrt(16))`           | 4      |
| `=(max(1, 5, 3))`       | 5      |
| `=(round(PI))`          | 3.14   |

- Operators are `+ - * / % **` and parentheses, with the usual precedence. `**` is the power operator; `^` is not accepted.
- Decimals use a dot, as in `1.5`. Scientific notation works too: `1e3`.
- Results are shown with at most 12 significant digits, so `0.1+0.2` shows `0.3`.

### Functions and constants

Everything in JavaScript's `Math` can be used without the `Math.` prefix:

- **Functions:** `abs`, `acos`, `acosh`, `asin`, `asinh`, `atan`, `atan2`, `atanh`, `cbrt`, `ceil`, `clz32`, `cos`, `cosh`, `exp`, `expm1`, `floor`, `fround`, `hypot`, `imul`, `log` (natural log), `log10`, `log1p`, `log2`, `max`, `min`, `pow`, `random`, `round`, `sign`, `sin`, `sinh`, `sqrt`, `tan`, `tanh`, `trunc`
- **Constants:** `PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`, `SQRT2`, `SQRT1_2`

Trigonometric functions use radians: `=(sin(PI/2))` gives `1`.

### `round(x, decimals = 2)`

Unlike `Math.round`, `round` takes the number of decimals to keep, and keeps **2 by default**:

| Formula                | Result |
|------------------------|--------|
| `=(round(12.1234))`    | 12.12  |
| `=(round(12.1234, 0))` | 12     |
| `=(round(12.1234, 3))` | 12.123 |
| `=(round(1234.5, -2))` | 1200   |
| `=(round(1.005))`      | 1.01   |

Halves are rounded away from zero, so `round(-2.5, 0)` gives `-3`.

## Named formulas and references

Add `#name` right after the closing parenthesis to name a formula. Other formulas can then use that name like a variable:

```
| Item   | Price          |
|--------|----------------|
| Apples | =(3*1.2)#apple |
| Pears  | =(2*1.5)#pear  |
| Total  | =(apple+pear)  |
```

The rules:
- **Characters:** a name starts with a letter (`A-Z`, `a-z`), followed by letters or digits, as in `price`, `a1` or `q3total`. `1a` is not a valid name. Names are case-sensitive, so `price` and `Price` are different names. It must touch the `)`: `=(1)#total` names the formula, `=(1) #total` does not.
- **Order:** a name can be used anywhere in the note, even above the line where it is defined.
- **Precision:** references use the exact value, not the rounded display. `=(10/3)#t` then `=(t*3)` gives `10`.
- **Live updates:** in the editor, changing a named formula immediately updates every formula that uses it.
- **Hidden name:** the name is not displayed. Hover the result to see the full formula.

## Errors

| Formula / situation                      | Displays                                     |
|------------------------------------------|----------------------------------------------|
| `=(1/0)`                                 | `error: Division by zero or overflow`        |
| `=(2^3)`                                 | `error: Forbidden character '^'`             |
| `=(foo(2))`                              | `error: Unknown identifier "foo"`            |
| `=(1 +)`                                 | `error: Unexpected end of expression`        |
| `=(sqrt(-1))`                            | `error: Result is NaN`                       |
| `=(round(1, 0.5))`                       | `error: round: decimals must be an integer`  |
| the same name defined twice              | `error: Duplicate name "price"`              |
| `=(1)#PI`                                | `error: "PI" is a reserved name`             |
| `=(b)#a` and `=(a)#b`                    | `error: Circular reference: a -> b -> a`     |
| a reference to a formula with an error   | `error: Reference "price" has an error`      |

## Good to know

- **Code is left alone.** Formulas inside inline code or code blocks are not computed and do not define names, which is handy for documenting the syntax.
- **Unclosed formulas.** A formula without its closing parenthesis, such as `=(1+1`, is left as plain text.
- **Editors.**
  - Live rendering needs the default Markdown editor (CodeMirror 6).
  - With the legacy Markdown editor, formulas are only computed in the preview.
  - The Rich Text editor is not supported.
- **Mobile.** The plugin is declared for mobile but has only been tested on desktop.
- **Safety.** Formulas are computed by a small built-in arithmetic parser, not by `eval`. A note can never run code.

## Installation

**From Joplin** (once published): open *Preferences → Plugins*, search for **Simple Formula**, click *Install*, then restart Joplin.

**Manually**:
1. Download `net.gangneux.joplin-simple-formula.jpl` from the [latest release](https://github.com/jrmgx/joplin-plugin-simple-formula/releases/latest).
2. In *Preferences → Plugins*, click the ⚙️ menu, then *Install from file*.
3. Pick the downloaded file and restart Joplin.

---

## Development

The plugin is plain JavaScript with no runtime dependency and no bundler. It requires Node.js 18 or later.

```bash
npm install
```

```bash
npm test
```

```bash
npm run build
```

`npm run build` writes `dist/`, plus `publish/net.gangneux.joplin-simple-formula.jpl` and its `.json` manifest copy.

To try changes without reinstalling, set *Preferences → Plugins → Advanced settings → Development plugins* to the absolute path of `dist/`. Then rebuild and restart Joplin after each change.

| File                       | Role                                                                                  |
|----------------------------|---------------------------------------------------------------------------------------|
| `src/index.js`             | Plugin entry point: registers both content scripts                                    |
| `src/evaluate.js`          | Expression parser and evaluator, formula finder, name resolution (shared)             |
| `src/markdownItFormula.js` | Preview: markdown-it rule                                                             |
| `src/codeMirrorFormula.js` | Editor: CodeMirror 6 live rendering, including Joplin's table widget                  |
| `scripts/build.js`         | Inlines `evaluate.js` into each content script, then packages the `.jpl`              |

To publish a new version:
1. Bump `version` in both `package.json` and `src/manifest.json`.
2. Commit and push.
3. Run `npm publish`. It rebuilds `publish/` through `prepare`.

The Joplin plugin repository picks up new npm versions automatically.

## License

MIT
