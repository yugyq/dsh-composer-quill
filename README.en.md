# Quill · dsh-composer-quill

Completion for the DSH composer. When a turn settles it offers a few next messages; when you pause while typing it finishes the sentence. `Tab` takes it, `Esc` dismisses it — sending is still your key to press.

[中文说明](README.md)

> If it helps you, give it a [Star](https://github.com/yugyq/dsh-composer-quill).

![Next message: candidates while the composer is empty, with the position shown on the chip](docs/assets/real-next.png)

```bash
dsh plugin --profile desktop add dsh-composer-quill
```

- **Staring at an empty box**: a few next messages appear when the turn ends; editing one is faster than starting from nothing
- **A sentence that will not come together**: type the first half and it continues; if the whole thing is tangled it returns one tidied version
- **Interrupted mid-thought**: switch away and back, the suggestion is still there
- **The paragraph you retype every day**: pulled from your own history, no model call

Everything stays on your machine: requests go through the model route you already configured, there is no third-party server, and nothing is reported.

## Four kinds of suggestion

Three cost a model call, usually one: completion asks again when the first answer does not parse, and next-message tops up when it gets a single candidate. History costs none.

**Next message**: several when a turn ends, `←` `→` to cycle. Also offered when you return to a Session you have talked in before.

**Completion**: appears when you pause; keep typing and it narrows until only the last few characters remain.

![Completion: what you typed in dark, the continuation in light](docs/assets/real-tail.png)

**Rewrite**: typos, broken punctuation, several requests crammed into one line — you get one tidied sentence, and taking it replaces the whole draft.

![Rewrite: typos and broken clauses tidied into one sentence, with the result shown on the chip](docs/assets/real-rewrite.png)

**History**: something you said before, taken straight from your own past messages with no model call, in milliseconds.

![History: mid-typing, the rest of a sentence you wrote earlier](docs/assets/real-history.png)

None of it interrupts you:

- after `Esc`, the same draft does not bring the suggestion back
- a request in flight does not blank the screen; the previous suggestion stays, marked `· writing…`
- IME composition is never interrupted, and is not treated as a draft

## Keys

| Key | Effect |
| --- | --- |
| `Tab` | Take the current suggestion |
| `←` `→` | Cycle candidates, when a next-message prediction has several |
| `Esc` | Dismiss; the same draft will not bring it back |
| `Ctrl+Shift+Space` | Ask for one now; the only entry point in manual mode |

While a suggestion is showing, `Tab` belongs to it. To move focus, press `Esc` first and `Tab` returns to the Host; `Enter` is unaffected.

## Install

Requires DSH `>=0.2.1-rc.2 <0.3.0` (a mismatched Host is refused at install time) and a model already configured in DSH. The plugin ships no model of its own; with nothing configured there are no suggestions.

```bash
dsh plugin --profile desktop add dsh-composer-quill                # from npm
dsh plugin --profile desktop add github:yugyq/dsh-composer-quill   # or from the repository
```

In the UI: **Settings → Plugins → Add plugin**, then `dsh-composer-quill`.

For running from source, checking which build is live, and making edits take effect, see [Development](docs/DEVELOPMENT.md). This is a third-party plugin with no affiliation with DeepSeek; if something breaks, open an [issue](https://github.com/yugyq/dsh-composer-quill/issues) with the relevant log lines.

## Settings

**Settings → Quill**: its own section in the settings navigation, not folded into General.

| Setting | Default | Meaning |
| --- | --- | --- |
| Next message | on | Candidates while the composer is empty |
| Completion | on | Complete while typing, and tidy the draft on the way |
| Mode | automatic | In manual mode, requests only happen on `Ctrl+Shift+Space` |
| Language | follow system | Once set, it is enforced; a draft in another language is rewritten wholesale |
| Pause | 120 ms | How long typing stops before a request, 80–2000 |
| Timeout | 20000 ms | Per-request ceiling, 3000–60000 |
| Model | follow the session | Which model writes the suggestions; the list comes from the routes DSH already has, and picking one does not change the session |
| Thinking | off | How hard to think; higher is slower and dearer, and may help a tangled rewrite |

Next message and completion are independent switches; turn one off to keep only the other.

**Usage**: the panel shows today's and lifetime call counts, input and output tokens, and a cost converted to CNY, with a reset for the lifetime totals. Amounts are booked at the peak or off-peak price in force *when the call happened* (peak is UTC weekdays 01:00–04:00 and 06:00–10:00). The ledger is `~/.dsh/composer-quill-usage.json`, numbers only.

**Acceptance feedback**: taking with `Tab`, dismissing with `Esc`, and sending without either are all counted, and reorder the next-message candidates.

Settings live in the browser's `localStorage`; nothing is sent anywhere.

## Privacy

- **Local only**: completion requests use the model route configured in DSH. No third-party server, no reporting.
- **Credentials masked**: before context leaves the machine, nine shapes become `[redacted …]` — private key blocks, AWS `AKIA…`, GitHub `ghp_` / `github_pat_`, OpenAI `sk-…`, Stripe, Slack `xox…`, JWTs, `Bearer …`.
- **The draft is masked too**: a secret-shaped string in the draft becomes `[redacted …]` as well, and a rewrite carrying that marker is discarded — this run gives no suggestion rather than sending the secret out.
- **Three local files**: diagnostics at `~/.dsh/composer-quill.log`, the usage ledger at `~/.dsh/composer-quill-usage.json` (counts and amounts only), and the suggestion cache at `~/.dsh/composer-quill-cache.json` (suggestion text; delete it to clear). All three share one directory and follow `DSH_PROFILE_DIR` / `DSH_HOME`.
- **Routes are authenticated**: the Host side requires this launch cycle's token or a same-origin browser request; the history route accepts the token only.

## How it works

- **Streaming**: completion runs over SSE, so the text grows as the model writes and `Tab` works at any point.
- **Two answer shapes**: a tail appended to the draft, or `REWRITE:` plus a whole sentence.
- **Context**: the last two turns, with older conversation as background only, plus one older row related to the draft.
- **Cache key**: draft, conversation version and settings. Same key, replay; changed key, discarded, so the same draft is never paid for twice.
- **Five local routes**: `/predict` for suggestions, `/history` for your own past messages, `/beacon` for diagnostics, `/usage` for the ledger, `/models` for the settings list.
- **Layout**: the suggestion layer sits inside the composer; wrapping and clipping are the Host's job.

Details in [Architecture](docs/ARCHITECTURE.md) and [Protocol](docs/PROTOCOL.md).

## Tests

149 unit checks and 61 browser scenarios, both in CI. The scenarios cover the real rhythms: fast typing, pausing for a suggestion, cancelling, switching Sessions, long-text layout.

```bash
npm test                          # 132 offline unit checks
npm run test:ui                   # 55 browser scenarios (bundled simulator)
npm test -- --filter=transcript   # run one behaviour
npm test -- --list                # list every case
```

The live-machine scripts, audit probes and the simulator live in `dev/`; see [Development](docs/DEVELOPMENT.md).

## Not there yet

- **A Session the Host has not loaded**: no context, so next-message and history have nothing to work from; completion still works.
- **One- or two-character drafts**: mostly guesswork, and usually a whole short sentence.
- **Length ceiling**: suggestions clip at three lines, because the composer only grows that far.

## Diagnostics

Start with `~/.dsh/composer-quill.log`; one JSON object per line.

- `request` / `cache-hit` / `cache-miss`: whether a model was actually called; a miss records what went into the key.
- `result`: how many candidates came back; failures read `skipped` / `empty-thread` / `wrong-language`.
- `empty-reply`: the model returned nothing, with the cap and finish reason that were in force.
- `hydrated`: a stored suggestion was reused.
- `next-ungrounded` / `next-empty`: candidates unrelated to the Session, or none left.
- `model-override` / `reasoning-setting`: a model or thinking level chosen in settings was applied.
- `dock-state`: the full UI state at that moment — phase, candidate count, whether the draft was empty.

## License

[MIT](LICENSE)
