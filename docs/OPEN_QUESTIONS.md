# Open questions

Each question has a recommended answer and the assumption I'm working on until you decide.

## Q-001 Phase 0 decisions (blocking)

- **Question:** approve the stack, city, tiles approach and Pages layout in [PHASE0_PROPOSAL.md](PHASE0_PROPOSAL.md)?
- **Recommendation:** as proposed: Python build plus TypeScript static app, Lyon, self-hosted Protomaps `z/x/y` tiles, project site at `/better-directions/`.
- **Assumption:** none. Phase 1 doesn't start until this is answered.

## Q-002 Shared fixture town

- **Question:** does the separate fixture-generator project (a shared made-up town) exist yet?
- **Recommendation:** start with a small hand-made mini-graph in this repo. That's enough for router and safety tests. Add the shared town later as an optional extra test input.
- **Assumption:** it doesn't exist yet, so I'm using local fixtures only.

## Q-003 Python version

- **Question:** which Python should run the build tooling?
- **Recommendation:** Python 3.12. It's already installed through Homebrew; the system's 3.9 is past end of life. CI will pin 3.12 the same way.
- **Assumption:** 3.12, in a project-local `.venv`.
