# GibsonFamily Hub — UI & UX Style Guide

This style guide captures the visual and interaction standards for **GibsonFamily Hub**. Because the app is used **99% on mobile phones**, every screen must stay minimal, scannable, and free of redundant controls or prose.

---

## 1. Core Principles

1. **No Duplicate Buttons or Controls**
   - Never repeat the same action (e.g., month pickers, "Log Income", "Period") in multiple places on the same screen.
   - Keep **one** canonical month selector per page at the top.
   - House secondary and manual-entry actions inside the page's **`Options`** menu rather than cluttering headers or cards with extra buttons.
   - Avoid manual entry buttons on summary cards when automated integrations (e.g., Plaid) already handle the workflow.

2. **Hamburger Menus for Secondary Selectors & Row Actions**
   - Use a compact hamburger menu (`☰` / `Menu` icon with `.tx-hamburger-btn` and `.tx-hamburger-popover`) for switching views, categories, or per-row actions instead of inline `<select>` dropdowns or multi-button toolbars.
   - Indicate the current selection in the menu (checkmark) and in the button's `title` attribute.

3. **Minimal Titles & Short Labels**
   - Use short, direct titles that do not repeat context already visible on the page (e.g., **"Budget"**, **"Overview"**, **"Categories"**, **"Rollover Ledger"**, **"Budget Period"**).
   - Do not prefix card titles with the active month (e.g., avoid *"November 2026 Category Budgets"* when the month pill is already at the top).
   - Keep metric box labels concise (e.g., **"Rollover"**, **"Spending Money"**) and badges brief (e.g., **`$1,200 to Savings`** instead of *"Balanced Budget ($1200 Savings)"*).
   - Omit redundant counts in section headings (e.g., **"Monthly Archive"** instead of *"Monthly Archive (3 Months)"*).

4. **No Unnecessary Subtitles — Use Mouseover Text or `<InfoTip />` (`i`)**
   - Avoid explanatory paragraphs, helper subtitles, and redundant summaries below headings, metric boxes, progress bars, or action bars (e.g., no *"Tap to open modal..."* or repeating bar-graph numbers in prose).
   - When helpful context *is* needed, place it in:
     - Native `title` attributes (mouseover text on desktop), or
     - The reusable **`<InfoTip text="..." />`** (`i` icon) component, which provides both `title` hover text on desktop and a tap-to-open popover on mobile.

5. **Consistent Spacing & Responsive Alignment**
   - Rely on `.module-container` (`gap: 1.25rem`) for vertical rhythm between sections; avoid stacking extra `margin-bottom` utilities on top of container gaps.
   - Page headers (`.section-header-bar`) should place the title and primary control (e.g., month pill or `Options` button) on the **same line on opposite sides**, wrapping cleanly below only when the viewport is too narrow.
   - Slim down pickers: prefer a single dropdown pill over prev/next arrow buttons when a month selector or ribbon is already present.
