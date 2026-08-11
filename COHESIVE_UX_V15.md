# Cohesive UX v15

This version is intentionally a UX/visual redesign rather than a data or workflow rewrite.

## Design goals
- Make the current location in the tool immediately obvious.
- Reduce visual competition between primary information and secondary metadata.
- Make common actions look primary and destructive/rare actions look secondary.
- Make orders scannable before they are expanded.
- Make forms feel grouped rather than like one continuous sheet of inputs.
- Use the same visual language across Admin, Employee, Finance, Quick Picker, Tracking, and public pages.
- Improve mobile usability without maintaining a separate mobile UI.

## Navigation
Admin navigation is grouped into:
- Workspace: Orders, Delivery Route, Quick Peek
- Operations: Inventory, Reviews, Employees
- Business: The Numbers, Financial Records
- System: Settings

Employee navigation remains intentionally small:
- Orders
- Payments
- Documents

The page title and helper text now change with the active tab instead of always saying Admin Dashboard.

## Orders
- Flatter, denser order cards with clearer name/time/equipment hierarchy
- Quieter metadata and badges
- In-progress and employee-assigned orders use a subtle left-edge treatment
- Expanded editors are visually grouped into digestible blocks
- Actions are visually separated from order data
- Collapsed order columns are more compact

## Forms and modals
- Consistent labels, focus states, field sizes, spacing, and button hierarchy
- Large modals use a sticky header
- Mobile modals become full-screen instead of cramped floating windows
- Information-heavy forms use bordered groups instead of an uninterrupted wall of inputs

## Mobile
- Sidebar becomes a horizontal swipeable navigation row
- Utility/logout links remain available in a second horizontal row
- Multi-column forms collapse to one column
- Order actions become large tap targets
- Modals use the full viewport

No Firestore rules, Functions, data schemas, or business calculations were changed in this version.
