# Employee Color Control v18

Employee order styling now has three independent admin controls:
- Accent / edge color
- Card background color
- Assigned employee badge color

The Employees page includes a live sample-order preview while colors are being selected. Badge text color is automatically switched between dark/light for readability.

Existing single `highlightColor` values remain compatible and are used as the default accent/badge when the new fields do not exist.

Expanded orders now also receive a crisp black 2px outside outline with spacing, in addition to the existing active-state glow and employee accent color.

No Firestore rule or Firebase Function changes are required. These values are saved on the existing employee profile through the existing admin-only profile update path.
