/*
 * remark-canon-links — rewrites the canon's relative .md links (e.g. "config-superiority.md",
 * "pages/developers.md") to the built site's clean routes. The route map is passed from
 * astro.config.mjs so routing stays defined in ONE place.
 */
export default function remarkCanonLinks(options = {}) {
  const routes = options.routes ?? {};
  const visit = (node) => {
    if (node.type === 'link' && typeof node.url === 'string' && node.url.endsWith('.md')) {
      const key = node.url.replace(/^\.\//, '').replace(/^pages\//, '').replace(/\.md$/, '');
      if (routes[key]) node.url = routes[key];
    }
    if (node.children) node.children.forEach(visit);
  };
  return (tree) => visit(tree);
}
