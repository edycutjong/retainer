# Prompts

ETHGlobal requires *"all spec files, prompts, and planning artifacts"* in the submission
repository when a spec-driven workflow is used, so judges can see how the AI was directed.

## What is in here

The prompts that **shaped** the build — architecture decisions, spec generation, and each
significant feature. One file per step, committed as the work happened rather than
reconstructed afterwards.

## What is deliberately not in here

Routine iteration ("fix this test", "rename that variable") is **not** transcribed. That
record already exists, with better fidelity, in the commit history — each commit shows what
changed and why.

Raw assistant session transcripts are also not included. They contain research and strategy
notes unrelated to directing this build, and dumping them would obscure the picture this
directory exists to give rather than clarify it.

The boundary is stated here explicitly so that what is included, and what is not, is visible.
