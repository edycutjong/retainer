---
name: Feature request
about: Suggest an idea for this project
title: "[Feature] "
labels: enhancement
---

**The problem**

What is hard or impossible today?

**The change you'd like**

**Alternatives considered**

**Does it touch the chain?**

If it changes `RetainerAccess.sol`, say what it costs — this contract pays for its own
scheduled executions out of a gas reserve, so anything that adds gas to `renew()` has a
recurring price. See [`docs/gas-economics.md`](../../docs/gas-economics.md).
