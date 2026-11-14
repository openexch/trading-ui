// SPDX-License-Identifier: Apache-2.0
// The ladder shell renders only when the page URL carries ?ui=ladder. The
// flag is read once per page load and never persisted, so the default screen
// stays the default until the cutover.

export function isLadderUiRequested(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).get('ui') === 'ladder';
}
