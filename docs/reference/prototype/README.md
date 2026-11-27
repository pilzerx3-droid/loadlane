# Loadlane prototype and landing page (reference only)

Two single-file HTML pages that were built with Claude before the product code existed. They are kept here as a **design and UX reference**. They are not product code.

| File                 | What it is                                                                                                                                       | Published at                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `app-prototype.html` | Clickable app demo: Overview, Loads, Documents, Quotes, Carriers, Alerts, Integrations, Driver link. Vanilla JavaScript, data in `localStorage`. | https://claude.ai/artifact/Exwku3pXbwzhdDKkQi3qHy |
| `landing-page.html`  | Landing page: hero, dashboard mockups, features, pricing, FAQ, waitlist that stores only in the browser.                                         | https://claude.ai/artifact/LXZFz6qEEyJ97fUXW3EmGw |

Snapshots taken on 2026-11-27. The published artifacts may have changed since. Open the HTML files in a browser to look at them; they need no server.

## Rules for using them

1. **Reference, not source.** Take ideas (information architecture, component patterns, wording, visual tokens). Do not copy their code, structure or sample data into the product (CLAUDE.md, non-negotiable 1 and 2, ADR 0008).
2. **Everything in them is simulated.** Loads, ETAs, positions, carrier on-time rates, documents and the "Scale API" or "Email bot" sources are invented for the demo. The product shows no sample data; empty states are empty (ADR 0011, CLAUDE.md rule 2).
3. **Fonts:** the pages load Inter and JetBrains Mono from Google Fonts. The product serves the fonts from its own server (both are SIL OFL 1.1) so that no visitor's address is sent to a third party.

## What the product takes from them

Design tokens (colors are the prototype's):

| Token               | Light     | Dark      |
| ------------------- | --------- | --------- |
| Background          | `#F3F4EF` | `#0E0F10` |
| Panel               | `#FFFFFF` | `#151617` |
| Text                | `#131513` | `#F3F4F2` |
| Muted text          | `#6A6F6A` | `#8D9093` |
| Accent (lime)       | `#C8EC2A` | `#D2F23C` |
| Accent text on lime | `#10130A` | `#10130A` |
| Positive / links    | `#3B7A00` | `#D2F23C` |
| Warning (late)      | `#B26B00` | `#FFB020` |
| Border              | 10% black | 9% white  |

Type: Inter for text, JetBrains Mono for buttons and labels. Radius 9 to 14 px. Light and dark themes follow the system setting.

Patterns: sidebar navigation with counts, overview with figure cards and an attention list, list with a detail panel, status chips, a six-step timeline, document inbox, mobile driver view, empty states.

## Where the prototype and the product differ on purpose

- The prototype has six plant-style steps (gate check-in, loading, weighing, departure, on the road, delivered). The product's status model has more states and defined transitions (docs/masterprompt.md, section 4A). How gate and weighing events fit in is decided in Phase 2.
- The prototype's Quotes tab keeps margin (on price) and markup (on cost) apart. That is the right idea and carries over to Phase 5; the product stores both separately and never mixes them (CLAUDE.md rule 6).
- The prototype navigation has eight entries. The product shows only entries whose pages exist and whose permission the person has.
