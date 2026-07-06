// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { wsAuthProtocols } from './useOmsSocket';

describe('wsAuthProtocols', () => {
  it('carries token-safe session tokens via the bearer subprotocol', () => {
    expect(wsAuthProtocols('a1b2c3-XYZ.~_')).toEqual(['bearer', 'a1b2c3-XYZ.~_']);
  });

  it('omits subprotocols for tokens illegal in Sec-WebSocket-Protocol', () => {
    // ':' is an RFC 2616 separator — ['bearer','dev:1'] would throw in the
    // WebSocket constructor. The dev OMS accepts a bare /ws/v1 connection.
    expect(wsAuthProtocols('dev:1')).toBeUndefined();
    expect(wsAuthProtocols('has space')).toBeUndefined();
    expect(wsAuthProtocols('')).toBeUndefined();
  });
});
