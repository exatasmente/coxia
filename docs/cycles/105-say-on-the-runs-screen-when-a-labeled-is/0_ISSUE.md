# 105 Say on the runs screen when a labeled issue has nobody assigned

- Endereço: https://github.com/exatasmente/coxia/issues/105
- Estado: open
- Rótulos: enhancement, coxia, priority:low
- Autor: exatasmente

## Descrição

## What should happen

The runner only starts issues that carry its label **and** are assigned to the person (the code host is asked for the person's own issues). An issue with the label and no assignee is silently ignored today. The runs screen lists such issues and offers to start one by hand.

Split from #54, which now covers only the documentation and the hint of the trigger field.

## Acceptance

- The runs screen lists open issues that carry the trigger label and have no assignee, with a way to start a run for one.
- Nothing starts by itself from that list.

## Notes

Needs a query of its own: the person's own issues do not include unassigned ones.

## Comentários

(sem comentários)
