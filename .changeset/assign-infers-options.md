---
"@openimport/core": patch
"@openimport/worker": patch
---

`session.assign()` now infers the same options as a suggested mapping (date order, decimal separator, enum value map), so picking a column by hand converts `15.03.1985` or `89,50` the same way an automatic match would. A new `{ exclusive: false }` option keeps the column on the other fields it fills, for one column that feeds several targets (e.g. a customer number on both a contact and a contract).
