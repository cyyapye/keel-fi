const nativeControls = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "details",
]);

// Consumer-owned placement is distinct from a shared control's appearance.
const placementProperties = new Set([
  "alignSelf",
  "justifySelf",
  "placeSelf",
  "order",
  "flex",
  "flexBasis",
  "flexGrow",
  "flexShrink",
  "gridArea",
  "gridColumn",
  "gridColumnStart",
  "gridColumnEnd",
  "gridRow",
  "gridRowStart",
  "gridRowEnd",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "marginBlock",
  "marginBlockStart",
  "marginBlockEnd",
  "marginInline",
  "marginInlineStart",
  "marginInlineEnd",
  "width",
  "minWidth",
  "maxWidth",
]);
const chartDimensions = new Set(["height", "minHeight", "maxHeight"]);

export default {
  meta: { name: "keel-ui" },
  rules: {
    "shared-controls": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          native:
            "Use @keel/ui instead of <{{name}}> in app consumers. See docs/product/ui-library.md.",
        },
      },
      create(context) {
        return {
          JSXOpeningElement(node) {
            if (
              node.name.type === "JSXIdentifier" &&
              nativeControls.has(node.name.name)
            ) {
              context.report({
                node: node.name,
                messageId: "native",
                data: { name: node.name.name },
              });
            }
          },
        };
      },
    },
    "no-inline-control-restyle": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          appearance:
            "Shared UI owns appearance. Use its documented variant; inline style accepts explicit placement properties only. See docs/product/ui-library.md.",
        },
      },
      create(context) {
        const imports = new Map();
        const namespaces = new Set();
        return {
          ImportDeclaration(node) {
            if (node.source.value !== "@keel/ui") return;
            for (const specifier of node.specifiers) {
              if (specifier.type === "ImportSpecifier") {
                imports.set(
                  specifier.local.name,
                  specifier.imported.name ?? specifier.imported.value,
                );
              } else if (specifier.type === "ImportNamespaceSpecifier") {
                namespaces.add(specifier.local.name);
              }
            }
          },
          JSXOpeningElement(node) {
            const name = node.name;
            const importedBinding = (local) => {
              let scope = context.sourceCode.getScope(node);
              while (scope) {
                const variable = scope.set.get(local);
                if (variable)
                  return variable.defs.some(
                    (definition) =>
                      definition.type === "ImportBinding" &&
                      definition.parent?.source.value === "@keel/ui",
                  );
                scope = scope.upper;
              }
              return false;
            };
            const component =
              name.type === "JSXIdentifier" && importedBinding(name.name)
                ? imports.get(name.name)
                : name.type === "JSXMemberExpression" &&
                    name.object.type === "JSXIdentifier" &&
                    importedBinding(name.object.name) &&
                    namespaces.has(name.object.name)
                  ? name.property.name
                  : undefined;
            if (!component) return;
            const style = node.attributes.find(
              (attribute) =>
                attribute.type === "JSXAttribute" &&
                attribute.name.name === "style",
            );
            if (!style) return;
            const expression =
              style.value?.type === "JSXExpressionContainer"
                ? style.value.expression
                : undefined;
            if (
              (expression?.type === "Literal" && expression.value === null) ||
              (expression?.type === "Identifier" &&
                expression.name === "undefined")
            )
              return;
            const valid =
              expression?.type === "ObjectExpression" &&
              expression.properties.every((property) => {
                if (property.type !== "Property" || property.computed)
                  return false;
                const key =
                  property.key.type === "Identifier"
                    ? property.key.name
                    : property.key.value;
                return (
                  placementProperties.has(key) ||
                  (component === "ChartContainer" && chartDimensions.has(key))
                );
              });
            if (!valid)
              context.report({ node: style, messageId: "appearance" });
          },
        };
      },
    },
  },
};
