# Progress

## Phases

- [x] **Phase 0: Decisions.** Proposal written; waiting for approval.
- [ ] Phase 1: Data pipeline
- [ ] Phase 2: Router core
- [ ] Phase 3: The modes
- [ ] Phase 4: The web page
- [ ] Phase 5: Delight
- [ ] Phase 6: GPS art (stretch)
- [ ] Phase 7: Hardening and launch prep (no deploy)

## Phase 0: Decisions (2026-11-24)

**Built:** [PHASE0_PROPOSAL.md](PHASE0_PROPOSAL.md), the decisions log ([DECISIONS.md](DECISIONS.md)) and open questions ([OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)). No code yet.

**Research done:**

- OSM feature counts for Minneapolis, Montreal, Lyon, Bologna and Edinburgh, using Overpass queries over comparable ~16 km² central boxes. The results are tabulated in the proposal.
- A range-request check on GitHub Pages using a real `.pmtiles` file. Pages applies byte ranges to the gzipped body, so single-file PMTiles is unsafe there (D-003).
- GitHub Pages limits, from GitHub's docs: 1 GB site, 100 GB/month soft bandwidth, 10-minute deploys.

**Recommendations:** see the proposal for the details.

- **Stack:** Python build, TypeScript static app.
- **City:** Lyon.
- **Tiles:** self-hosted Protomaps tiles as a static `z/x/y` folder.
- **Pages layout:** project site at `/better-directions/`.
- **Expected site size:** 15–35 MB.

**Tests and performance:** none yet; no code.

**Skipped:**

- I didn't measure the real tile and graph sizes for Lyon. That needs the approved tooling and download hosts, so it moves to Phase 1.
- I didn't deploy a test file to Pages. That would mean pushing, which is a big item. Testing the existing public PMTiles file on Pages answered the question instead.
