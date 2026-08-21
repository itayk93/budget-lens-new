# RTL (Hebrew) Development Guidelines

This document outlines the standards for maintaining a high-quality RTL user experience in this project.

## 1. Principles

### Logical Directions
Avoid physical directions (`left`, `right`) in CSS and component logic. Instead:
- Use `dir="rtl"` on the root or major containers (app layout).
- Use `start` and `end` concepts.
- In Tailwind, prefer `ps-` (padding-start) and `pe-` instead of `pl-` and `pr-` if using a modern enough version, otherwise manually swap `pl` and `pr` based on the context.

### Forced Context
Some UI library components (e.g., Radix-based components like `Select`, `Dialog`, `DropdownMenu`) may not inherit the direction correctly when portaled. 
**Always explicitly set `dir="rtl"` on these interactive primitives.**

## 2. Icon Spacing

**Critical Rule:** In RTL, icons adjacent to text must use `ml-2` (margin-left) instead of `mr-2` (margin-right).

This applies globally to:
- Search icons (`<Search>`) in command inputs
- Checkbox/check icons in list items
- Action icons (Plus, Upload, Archive, etc.) in buttons and menu items

**Why:** In RTL, the text flows right-to-left. An icon on the right side of the text needs a left margin (`ml-2`) to create visual separation. Using `mr-2` pushes spacing in the wrong direction.

## 3. Component Patterns

### Buttons
- Icons should generally be placed using `ml-2` (left margin) to separate them from the text on their left (in RTL).
- **Navigation Arrows**: 
  - "Next" (`ChevronLeft` or `ArrowLeft` in RTL).
  - "Back" (`ChevronRight` or `ArrowRight` in RTL).

### Select / Combobox
- **Trigger**: Must have `dir="rtl"` and `flex-row-reverse` if the icon order is wrong, or rely on `justify-between` with `dir="rtl"`.
- **Items**: Text padding should be on the right (`pr-8`) to make room for the check icon on the right/left as per design.
- **Check Icon**: Positioned at `right-2`.

### Inputs & Textareas
- Ensure `text-right` is applied or inherited.
- Placeholder text must also be right-aligned.

### Searchable Dropdowns (Tag Selectors, etc.)
- **Inline creation:** Always allow creating new items when search yields no match. Show a "צור [שם]" option at the bottom of the list.
- **Anti-jump:** Place selected item chips **below** the dropdown trigger, not above. Use `side="bottom"` and `avoidCollisions={false}` on PopoverContent.
- **Manual filtering:** Use `shouldFilter={false}` on `<Command>` and filter the list manually to prevent cmdk from interfering with selection state.

## 4. Common Fixes

### The "Stray Icon" Issue
If a button or select box shows the label on the left and the icon on the right (like in LTR), it usually means the parent has `flex` and `justify-between` but the `dir="rtl"` is missing or ignored.
**Fix**: Add `dir="rtl"` to the flex container.

### The "Jumping Popover" Issue
When a popover's anchor element changes size (e.g., tags chips appearing), the popover repositions.
**Fix**: Move dynamic content below the trigger, use `avoidCollisions={false}`.

### Absolute Positioning
- If an element is at `left-2` in LTR, it should be at `right-2` in RTL if it's meant to be an "accessory" icon (like a checkmark).

## 5. Typography
- Use fonts that support Hebrew well (e.g., Inter, Assistant, Heebo).
- Avoid letter-spacing on Hebrew text as it can reduce legibility.
