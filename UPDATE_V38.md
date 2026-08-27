# V38

- Fixed Orders calendar exchange/return dates rendering one day late by removing mixed noon/midnight date arithmetic and using calendar-day serial math.
- Orders calendar now carries existing assignment/status visual logic: Pending remains red; assigned active orders use employee colors; In-Progress keeps a yellow state outline; completed remains neutral.
- Typical weekly schedule is collapsed by default behind **Edit Weekly Schedule** and collapses again after saving.
- Tightened dashboard spacing throughout the admin/employee app, including headers, cards, collapsed archive, forms, Orders lists, and Schedule.
