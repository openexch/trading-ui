// SPDX-License-Identifier: Apache-2.0
// The project ships without @types/node; tests that read source files from
// disk need only this one function.
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
