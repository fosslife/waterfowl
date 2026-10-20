/**
 * Height of one virtual data-grid row at a root font size.
 * Text cells use --text-xs (0.75rem) at line-height 1.5, plus --space-2 padding and a 1px border.
 * A selected row also has a 16px checkbox inside the same padding.
 * The virtualizer slot uses this height, and the row is rendered at that same height.
 */
const TEXT_LINE = 0.75 * 1.5;
const VERTICAL_PADDING = 0.5 * 2;
const BORDER_PX = 1;
const CHECKBOX_PX = 16;

export function dataTableRowHeight(fontSizePx: number): number {
  const padding = fontSizePx * VERTICAL_PADDING;
  const text = fontSizePx * TEXT_LINE + padding + BORDER_PX;
  const checkbox = CHECKBOX_PX + padding + BORDER_PX;
  return Math.ceil(Math.max(text, checkbox));
}
