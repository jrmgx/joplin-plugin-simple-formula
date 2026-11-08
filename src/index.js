/* global joplin */
joplin.plugins.register({
  onStart: async function () {
    // Viewer (preview): renders =(expr) as its result.
    await joplin.contentScripts.register(
      'markdownItPlugin',
      'simpleFormula',
      './markdownItFormula.js'
    );
    // Markdown editor (CodeMirror 6): live rendering outside the line being edited.
    await joplin.contentScripts.register(
      'codeMirrorPlugin',
      'simpleFormulaEditor',
      './codeMirrorFormula.js'
    );
  },
});
