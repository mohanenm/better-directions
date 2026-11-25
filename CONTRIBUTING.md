# Contributing

Issues and pull requests are welcome. Please open an issue first for anything bigger than a fix.

## Before you open a pull request

- `npm run check` passes (typecheck, lint, all tests including the safety property test).
- If you touched the pipeline, `.venv/bin/python -m pytest` and `ruff check pipeline` pass too.
- If you touched the page, `npm run smoke` passes against `npm run pages:gz`.
- Commits are small and do one thing.

## Safety rules

The walking rules in `pipeline/bdgraph/safety.py` and `app/src/safety/rules.ts` are deliberately hard to change. Any change needs a case in `safety/cases.json` that both implementations pass, and a reason in the pull request. Never edit a case just to make a test pass. Making a rule stricter is usually fine; loosening one needs a very good reason and a maintainer's agreement.

The page must not make requests to other hosts, set cookies, use storage or collect anything. New runtime dependencies need discussion first.

## Writing style

Docs, UI text, code comments, test names and commit messages should read like one careful person wrote them: specific, brief, and dry rather than excited.

- Say what it does, plainly. Cut filler and hype words such as "seamless", "robust", "powerful", "leverage", "comprehensive" and "effortlessly".
- No formulaic openers or closers ("Here's…", "In summary", "It's worth noting that…").
- Don't restate the heading in the first sentence, and don't group things in threes by reflex.
- Prefer short paragraphs to bullet lists, and a sentence to a table of three facts. Use bold sparingly.
- No emoji in docs or commits, and go easy on dashes.
- Comment the why where it isn't obvious. No comment on every line, and no docstring that repeats the function name.
- Test names state the behaviour briefly: "drops unmarked passages through flats", not a paragraph.
- Commit messages are short and imperative: "Add workout mode", "Fix panel scroll on mobile". Add a body if the why isn't obvious.
- Say what's tested and what isn't. Don't overclaim.
- Public docs say what something does and how to use it. Long reasoning and abandoned options belong in the pull request.

When in doubt, cut.
