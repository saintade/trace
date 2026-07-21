# Trace — Devpost submission kit

## Submission fields

**Project name:** Trace

**Tagline:** An AI professor that can see your work.

**Track:** Education

**Repository:** https://github.com/saintade/trace

**Demo URL:** `[ADD PUBLIC HTTPS DEMO]`

**Video URL:** `[ADD PUBLIC YOUTUBE VIDEO — UNDER 3 MINUTES]`

**Codex `/feedback` Session ID:** `[ADD THE SESSION ID FOR THE MAJORITY OF BUILD WEEK WORK]`

## Inspiration

AI tutors usually make learning look like customer support: a chat box, an answer, and another prompt. But real teaching is spatial and collaborative. A good professor watches how a learner approaches a problem, points to the exact mistake, draws when words are not enough, and asks the learner to demonstrate understanding.

Trace began with a simple question: what if the AI tutor shared your whiteboard instead of waiting behind a chat box?

## What it does

Trace is a voice-first professor on an infinite shared whiteboard. There is no prompt box and no separate IDE. The learner speaks, sketches, drops in course material, and writes code in one continuous workspace.

On every spoken turn, the professor receives a fresh image of the board. It can respond naturally through OpenAI Realtime, compose an original visual explanation with GPT‑5.6 Sol, and point, circle, or underline the relevant part while speaking. Learners can interrupt at any time.

PDF textbooks remain local to the browser. Trace indexes their text locally, searches and reads bounded page ranges, and can physically open the exact cited page when the learner says “show me the source.” Borderless “living code ink” for Python, JavaScript, C17, and C++20 lives directly on the canvas. Before a meaningful run, the learner's spoken prediction is pinned beside the code; the observation is revealed only after execution so the professor can compare them before explaining.

When a learner revises an important idea, Trace can preserve the change as a consent-based Misconception Trail: original model, turning evidence, revised model, and a next transfer test. At the end of a meaningful lesson, it can create a Learning Trace with the goal, specific evidence the learner demonstrated, verified source pages, and one next challenge. It deliberately does not label passive listening as mastery.

## How we built it

- **OpenAI Realtime + Agents SDK:** low-latency speech-to-speech teaching, semantic turn detection, interruption, transcription, and client-side whiteboard tools.
- **GPT‑5.6 Sol Responses API:** strict structured output for board-aware SVG explanations and evidence-based Learning Traces.
- **GPT Image 2:** photographic or painterly references when vector explanation is the wrong medium.
- **tldraw:** the shared spatial workspace, custom PDF and CodeMirror shapes, camera motion, and ephemeral professor gestures.
- **PDF.js + IndexedDB:** local rendering, storage, and page-level text indexing without uploading textbook bytes to the application server.
- **Web Workers + Pyodide + local sandboxing:** isolated JavaScript, Python, C17, and C++20 learning snippets.
- **Next.js + SQLite FTS5:** server-only OpenAI credentials, session metadata, transcripts, and local search.

Model-produced SVG is treated as untrusted external content and sanitized before import. Inputs, outputs, page reads, execution time, and process output are bounded. Long-lived OpenAI credentials never reach the browser; it receives a short-lived Realtime client secret.

## What is meaningfully new for Build Week

The repository's first commit is an untouched Create Next App scaffold. Build Week work, created with Codex, includes the entire Trace experience: Realtime voice teaching, board vision, GPT‑5.6 visual composition, gestures, local PDF intelligence, exact-page source navigation, executable canvas code, multi-session memory, Learning Traces, safety boundaries, onboarding, documentation, and submission materials.

This commit boundary makes the pre-existing scaffold and the hackathon implementation directly auditable.

## Challenges we ran into

**Making voice and canvas act like one conversation.** Automatic voice replies could begin before the latest board image was attached. We disabled automatic response creation, queue each committed voice turn, export the current board, attach it without triggering a reply, and only then request the response.

**Creating useful visuals instead of generic diagrams.** A single realtime agent was fast but inconsistent at layout. We split intent from composition: the professor chooses the teaching purpose and visual language, while a dedicated GPT‑5.6 Sol pass sees the board and returns strict SVG plus ordered teaching beats.

**Grounding without uploading a student's library.** PDF bytes, rendered pages, and the full text index stay in IndexedDB. The professor sees only explicit, bounded page results returned through local tools.

**Running code without turning the product into a remote execution service.** JavaScript and Python run in disposable browser workers. Native code is explicitly limited to a trusted local macOS learning environment with denied network access, timeouts, and output caps.

## Accomplishments we are proud of

- The professor does not merely “see an uploaded file”; it can move the shared camera to the exact page it cites.
- Spoken explanation can visibly track a generated diagram through ordered, animated teaching beats.
- Code is not pasted into chat. It remains editable, runnable shared work on the board.
- Learning progress is described through predictions, revisions, observed evidence, and next tests—not engagement metrics or invented mastery scores.
- The core whiteboard and document library are local-first and usable without creating an account.

## What we learned

The most important lesson was that multimodal education is not just adding voice and images to chat. The interface must let the learner keep ownership of the work. That changed our architecture: the board is primary, the professor's gestures are ephemeral, learner code is never silently rewritten, and document claims can be brought back to a visible source.

We also learned that a compelling explanation is not evidence of learning. Learning Traces were designed to close that loop by separating what the learner demonstrated from what should be tested next.

## What's next

- Compare Learning Traces across sessions to schedule retrieval practice around specific evidence gaps.
- Add math-aware PDF extraction for equations, figures, and tables.
- Let teachers author bounded lesson goals while keeping learner work private and local.
- Run classroom pilots measuring explanation quality, interruption comfort, and delayed recall—not just session length.

## Judge testing instructions

1. Use a desktop browser with microphone access and open the HTTPS demo.
2. Say: “Teach me gradient descent visually, then ask me to predict the next step.”
3. Interrupt once and draw on the board before answering.
4. Drop a non-sensitive PDF, ask a question about it, then say: “Show me the source.”
5. Add and run a code cell, then ask the professor to explain the output.
6. Say: “Make my Learning Trace from what I actually demonstrated.”

PDFs and canvases are stored on the testing device. Native C/C++ execution is a trusted-local macOS feature; use Python or JavaScript in a hosted demo.

## Final submission checklist

- [ ] Register/join OpenAI Build Week on Devpost.
- [ ] Select the **Education** track.
- [ ] Paste the Codex `/feedback` Session ID required by the submission form.
- [ ] Add the public HTTPS demo URL and test microphone permissions.
- [ ] Record a public YouTube demo under three minutes with clear audio.
- [ ] Explicitly explain how Codex and GPT‑5.6 were used.
- [ ] Show the live product before architecture slides.
- [ ] Add 3–5 strong screenshots, including a visual lesson, exact PDF source page, runnable code, and Learning Trace.
- [ ] Confirm the repository is public and the MIT license is visible.
- [ ] Submit before **July 21, 2026 at 5:00 PM Pacific**.
