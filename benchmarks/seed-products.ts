import ts from "typescript";

export type SeedProduct = {
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
};

function literalString(object: ts.ObjectLiteralExpression, key: string) {
  const property = object.properties.find((item): item is ts.PropertyAssignment =>
    ts.isPropertyAssignment(item) && item.name.getText().replace(/["']/g, "") === key
  );
  return property && (ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer))
    ? property.initializer.text
    : null;
}

function literalNumber(object: ts.ObjectLiteralExpression, key: string) {
  const property = object.properties.find((item): item is ts.PropertyAssignment =>
    ts.isPropertyAssignment(item) && item.name.getText().replace(/["']/g, "") === key
  );
  if (!property) return null;
  if (ts.isNumericLiteral(property.initializer)) return Number(property.initializer.text);
  if (ts.isPrefixUnaryExpression(property.initializer) && ts.isNumericLiteral(property.initializer.operand)) {
    return property.initializer.operator === ts.SyntaxKind.MinusToken
      ? -Number(property.initializer.operand.text)
      : Number(property.initializer.operand.text);
  }
  return null;
}

export function extractSeedProducts(sourceText: string): SeedProduct[] {
  const source = ts.createSourceFile("seed.ts", sourceText, ts.ScriptTarget.Latest, true);
  let productsArray: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "products" && ts.isArrayLiteralExpression(node.initializer)) {
      productsArray = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!productsArray) throw new Error("products array not found in prisma/seed.ts");

  return productsArray.elements.filter(ts.isObjectLiteralExpression).map((object) => ({
    name: literalString(object, "name"),
    calories: literalNumber(object, "calories"),
    protein: literalNumber(object, "protein"),
    fat: literalNumber(object, "fat"),
    carbs: literalNumber(object, "carbs"),
  })).filter((item): item is SeedProduct =>
    Boolean(item.name)
      && [item.calories, item.protein, item.fat, item.carbs].every(Number.isFinite)
      && item.calories! > 0
  );
}
