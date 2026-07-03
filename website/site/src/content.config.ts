// Content collections (Astro 5 content layer). The canon markdown lives one directory up —
// website/ IS the content source of truth (the ruled 2026-06-12 venue); this build renders it
// in place. No copies, no second content tree (pointer-not-copy).
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

const canon = defineCollection({
  loader: glob({ pattern: ['index.md', 'pages/*.md'], base: './..' }),
});

export const collections = { canon };
