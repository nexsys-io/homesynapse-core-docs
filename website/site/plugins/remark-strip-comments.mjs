/*
 * remark-strip-comments — removes HTML comment blocks (the canon's provenance/planning
 * appendices, "review-only — strip at publish" per website/README.md) from rendered output.
 * The comments remain in the source canon; they simply never ship in HTML.
 *
 * CommonMark HTML blocks of type 2 (<!-- ... -->) run until the line containing "-->", so a
 * multi-line provenance comment is ONE mdast `html` node — but a belt-and-braces open-comment
 * state guards against parser splits.
 */
export default function remarkStripComments() {
  const strip = (node) => {
    if (!node.children) return;
    let inComment = false;
    node.children = node.children.filter((child) => {
      if (child.type === 'html' && typeof child.value === 'string') {
        const v = child.value.trim();
        if (inComment) {
          if (v.includes('-->')) inComment = false;
          return false;
        }
        if (v.startsWith('<!--')) {
          if (!v.endsWith('-->')) inComment = true;
          return false;
        }
      }
      return true;
    });
    node.children.forEach(strip);
  };
  return (tree) => strip(tree);
}
