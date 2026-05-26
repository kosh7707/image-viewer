/**
 * Hand-crafted minimal valid image byte buffers for tests.
 * These exist so tests can run without binary fixtures committed to the repo.
 */

// 1x1 PNG (valid; image-size verified).
export const PNG_1x1: Buffer = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6300010000050001AC1F1ED10000000049454E44AE426082',
  'hex',
);

// 1x1 single-frame GIF (43 bytes; gifuct-js parses 1 frame).
export const GIF_1x1_1FRAME: Buffer = Buffer.from(
  '47494638396101000100F00000FFFFFF00000021F90404640000002C00000000010001000002024401003B',
  'hex',
);

// 1x1 two-frame GIF (valid; gifuct-js parses 2 frames).
export const GIF_1x1_2FRAMES: Buffer = Buffer.from(
  '47494638396101000100F00000FFFFFF00000021F90404640000002C000000000100010000020244010021F90404640000002C0000000001000100000202440100' +
    '3B',
  'hex',
);
