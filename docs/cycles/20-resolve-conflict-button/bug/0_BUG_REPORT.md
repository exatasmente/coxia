# #20 "Resolve conflict" never shows for cards from a code-host integration — bug report

## What happens

A workspace whose cards are built by its code-host integration (GitHub, GitLab or Bitbucket, with no external card-source command) has a pull or merge request that conflicts with its target branch. The card is blocked, the row on Today says so, but:

- Today's "needs you" row has no "Resolve conflict" button;
- the unblock screen (Deep) has no conflict panel;
- so there is no way to open the conflict-resolution flow from the card.

## Expected

The button shows whenever a merge request of the card conflicts, whatever the host, the card source or the interface language.

## Evidence

- The card says "Conflicts with the target branch" (or "Conflito com a branch de destino" in pt-BR) next to the MR reference, so the data is known and shown; only the button is missing.
- A workspace that uses an external card-source command, whose report writes "MR com conflitos", does show the button.

## Scope

In: the three places that decide whether a card has a conflicting MR (`conflictMrs`, the Today needs list, and what they feed). Out: how a conflict is resolved (`conflictFromMr`), and hosts that report no conflict flag at all (Bitbucket).
