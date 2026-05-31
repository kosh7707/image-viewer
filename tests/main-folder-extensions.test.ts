import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as ts from 'typescript';

function arrayLiteralStrings(file: string, variableName: string): string[] {
  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const values: string[] = [];
  let found = false;

  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      assert.ok(node.initializer, `${variableName} should have an initializer`);
      const initializer = ts.isAsExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      assert.ok(initializer && ts.isArrayLiteralExpression(initializer));
      for (const element of initializer.elements) {
        assert.ok(ts.isStringLiteralLike(element));
        values.push(element.text);
      }
      found = true;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.equal(found, true, `${variableName} should exist in ${file}`);
  return values;
}

test('main readable extension whitelist matches folder SUPPORTED_EXTS', () => {
  assert.deepEqual(
    arrayLiteralStrings('src/main/main.ts', 'READABLE_IMAGE_EXTS'),
    arrayLiteralStrings('src/main/folder.ts', 'SUPPORTED_EXTS'),
  );
});
