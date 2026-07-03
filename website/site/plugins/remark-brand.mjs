/*
 * remark-brand — substitutes the name-light placeholders {{productName}} / {{companyName}}
 * in markdown TEXT nodes with the values from src/lib/brand.mjs (passed as options, so the
 * brand module stays the single source of truth). Code/inlineCode nodes are left untouched.
 */
export default function remarkBrand(options = {}) {
  const brand = options.brand ?? {};
  const replace = (value) =>
    value
      .replaceAll('{{productName}}', brand.productName ?? '{{productName}}')
      .replaceAll('{{companyName}}', brand.companyName ?? '{{companyName}}');
  const visit = (node) => {
    if (node.type === 'text' && typeof node.value === 'string') {
      node.value = replace(node.value);
    }
    if (node.children) node.children.forEach(visit);
  };
  return (tree) => visit(tree);
}
