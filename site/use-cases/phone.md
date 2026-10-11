# The paired phone approves

The route from the desk to the door is short, and the phone is a full way in: the cycle is run from
the phone as from the window.

**Pairing.** The app serves its own browser interface on the local network and shows a code to pair
with. The phone keeps that login between uses, and the app decides what the paired browser may call:
reads are open, and the writes are the ones that can be undone or that only take capability away —
answering a question, deciding a gate, cancelling a run, opening a pull request *only* with the
external-effects switch on.

**A gate.** The run stops and the phone is notified. The person reads the stage exactly as the
window shows it — timeline, findings, the review's lines and the QA scenarios — and decides:
approve, reject with a reason, or send the work back to a stage.

**A yes.** The push of a branch and the opening of a pull request are proposals, and the phone can
approve them; the switch that allows a proposed write from the phone is the same one that governs
every external effect, and it is off until the person turns it on.

**What the phone cannot do.** It cannot name a program or a folder, cannot take control of a live
screen, and cannot raise an agent's permissions — it can only lower them. Nothing of the
configuration or of the secrets is served to it.

What each channel does and which ones a paired browser reaches is in
[The runner](/reference/runner#channels).

<!-- site:image-placeholder -->
> **Screenshot (pending).** A gate decided from the phone. Taken from the app over a seeded workspace
> with fictitious data, refreshed with each release.
