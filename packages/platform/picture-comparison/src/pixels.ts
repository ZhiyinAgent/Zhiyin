/** Four bytes a pixel, row by row: red, green, blue and opacity. */
export type Pixels = {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
};
