import { describe, expect, it } from 'vitest';

import * as sdk from '../src';

describe('package exports', () => {
  it('exposes the public API', () => {
    for (const name of [
      'createChatClient',
      'sessionAuth',
      'bearerAuth',
      'ChatError',
      'ChatSocket',
      'ChatStore',
      'selectUnreadTotal',
    ]) {
      expect(sdk).toHaveProperty(name);
    }
  });
});
