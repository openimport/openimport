---
"@openimport/core": patch
---

Edits in the review step no longer scale with the file size. Uniqueness and stats are now kept in an index that an edit updates only for the rows it affects (the edited row and rows sharing one of its unique values). At 1,000,000 rows an edit takes about 1 ms instead of ~850 ms; building the index adds a few percent to the initial validation.
