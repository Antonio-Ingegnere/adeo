# Current feature workflow

Normal feature requests may create `current.md` automatically through the
`/feature` rules; `/feature start request="..."` does so explicitly. FAST and
STANDARD keep their complete brief or mini spec in that one file. FULL uses it
as a small mode/status pointer to the detailed plan under `.claude/plans/`.

Do not store review transcripts or duplicate source documentation here. Replace
a completed `current.md` only when starting the next feature; never overwrite an
unfinished feature without explicit user direction.
