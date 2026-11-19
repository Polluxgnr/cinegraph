// Lists every string that needs a French translation: literal arguments of T()/t()/tr() anywhere, plus the UI
// text in label tables. Writes scripts/i18n-keys.json and prints the ones missing from lib/i18n.fr.ts.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = [...walk("app"), ...walk("components"), ...walk("lib")].filter((f) => /\.tsx?$/.test(f) && !/\.(test|eval|bench)\.ts$/.test(f) && !f.endsWith("i18n.fr.ts"));
// label tables: every string literal inside these object/array literals is UI text
const TABLES = new Set(["DOMAINS", "SEEN_DEFAULT", "MAIN", "GLOBAL", "MOODS", "HINT", "HERO", "LINK_LABEL", "LABEL", "NOT_FOR_ME", "SHORT", "METHODS", "FILTERS", "PILL"]);
const keys = new Set();
for (const file of files) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node, inTable) => {
    if (ts.isCallExpression(node) && ["T", "t", "tr", "translate"].includes(node.expression.getText())) {
      const a = node.arguments[node.expression.getText() === "translate" ? 1 : 0];
      if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) keys.add(a.text);
      if (a && ts.isConditionalExpression(a)) for (const b of [a.whenTrue, a.whenFalse]) if (ts.isStringLiteral(b)) keys.add(b.text);
    }
    let table = inTable;
    if (ts.isVariableDeclaration(node) && TABLES.has(node.name.getText())) table = true;
    if (table && ts.isStringLiteral(node) && /[A-Za-z]/.test(node.text) && !/^(\/|https?:|[a-z]+$|[a-z_]+:|#)/.test(node.text)) {
      // property names like `label:` aren't text, values are
      if (!(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) keys.add(node.text);
    }
    // object-literal labels of moreTabs()/exploreLinks()/steps
    if (ts.isPropertyAssignment(node) && ["label", "short", "seen", "unseen", "title", "sub", "brings", "name"].includes(node.name.getText()) && ts.isStringLiteral(node.initializer) && /\s|[A-Z]/.test(node.initializer.text)) keys.add(node.initializer.text);
    ts.forEachChild(node, (c) => visit(c, table));
  };
  visit(sf, false);
}
const fr = (() => { try { const s = readFileSync("lib/i18n.fr.ts", "utf8"); return new Set(Object.keys(JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)))); } catch { return new Set(); } })();
const all = [...keys].filter((k) => /[A-Za-z]/.test(k)).sort();
writeFileSync("scripts/i18n-keys.json", JSON.stringify(all, null, 1));
const missing = all.filter((k) => !fr.has(k));
console.log(`${all.length} keys, ${missing.length} missing in lib/i18n.fr.ts`);
writeFileSync("scripts/i18n-missing.json", JSON.stringify(missing, null, 1));
