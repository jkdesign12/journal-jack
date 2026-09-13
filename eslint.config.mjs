import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    rules: {
      /* The journal document is edited in place — a note typed, a tile moved, a
         colour picked — and the store tells React that something changed with a
         version number rather than by replacing the document.

         That is deliberate. The document is large, it is edited constantly, and
         copying it on every keystroke to satisfy a rule about props would cost
         more than it explains. This rule assumes the other design, so it is off
         here rather than silenced in a dozen places one by one. */
      'react-hooks/immutability': 'off',
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
