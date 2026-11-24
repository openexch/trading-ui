// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * The user stream's auth subprotocol and URL rule: an explicit
 * VITE_STREAM_WS_URL, else same origin /ws/v2; never derived from the REST
 * base.
 */
import { describe, it, expect } from 'vitest';
import { userStreamUrl, wsAuthProtocols } from './useUserStream';

describe('useUserStream helpers', () => {
  it('sends a subprotocol-safe token as [bearer, token]', () => {
    expect(wsAuthProtocols('q3W0mB8x-_abc')).toEqual(['bearer', 'q3W0mB8x-_abc']);
    expect(wsAuthProtocols('eyJh.eyJz.sig')).toEqual(['bearer', 'eyJh.eyJz.sig']);
  });

  it('uses first-frame auth for a dev token (":" is not a subprotocol character)', () => {
    expect(wsAuthProtocols('dev:1')).toBeUndefined();
  });

  it('without VITE_STREAM_WS_URL the stream is same origin /ws/v2', () => {
    expect(userStreamUrl()).toBe(`ws://${window.location.host}/ws/v2`);
  });
});
