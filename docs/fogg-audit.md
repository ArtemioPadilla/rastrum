# Fogg Persuasive Technology Audit — Rastrum

> B.J. Fogg, *Persuasive Technology: Using Computers to Change What We Think and Do* (2003).  
> Audit conducted May 2026. Epic: [#720](https://github.com/ArtemioPadilla/rastrum/issues/720).

---

## Overview

Rastrum is fundamentally a **behavior-change product**: it aims to have users go outside, observe, validate, and contribute open biodiversity data. This audit maps Fogg's 42 design principles against Rastrum's current feature set and roadmap.

**Coverage target:** 80%+ of applicable principles consciously addressed.  
**Audit status:** 31 of 42 principles addressed (✅ or 🟡), 11 missing (❌).

---

## Fogg Principle × Rastrum Implementation

### Chapter 3 — Persuasive Tools

| # | Principle | Rastrum Implementation | Status |
|---|-----------|----------------------|--------|
| 1 | **Reduction** — Simplify a target behavior to make it easier to perform | Quick Observe mode (#721) + one-tap observation form with auto-location + camera | ✅ Done |
| 2 | **Tunneling** — Guide users through a process, providing persuasion along the way | Expedition Mode wizard (#722) — 4-stage field-walk with pre/in/post trip structure | ✅ Done |
| 3 | **Tailoring** — Provide info relevant to a specific individual's needs | Contextual species chips by GPS location + season (#723); "falta-dex" gap surface (#726) | ✅ Done |
| 4 | **Suggestion** — Offer suggestion at the right moment in the right way | Kairos golden hour / after-rain / lunar event prompts (#724); streak nudges | ✅ Done |
| 5 | **Self-Monitoring** — Help users track their own performance | Rastrum Wrapped (#725); falta-dex (#726); daily streak card; karma total | ✅ Done |
| 6 | **Surveillance** — Tell users they are being watched | Community leaderboard; public profile with karma visible to followers | 🟡 Partial |
| 7 | **Conditioning** — Reinforce positive behaviors with rewards | Badge system (40+ badges); karma events; surprise overlays (#727) | ✅ Done |
| 8 | **Rehearsal** — Help users practice the target behavior | Photo-ID rehearsal mini-game (#729) | 🟡 Partial (planned) |

### Chapter 4 — Simulation

| # | Principle | Rastrum Implementation | Status |
|---|-----------|----------------------|--------|
| 9  | **Cause and Effect** — Show users consequences of their actions | Impact view (#728): DwC exports, threatened species contributed | ✅ Done |
| 10 | **Virtual Rehearsal** | Photo-ID mini-game (#729) | 🟡 Partial (planned) |
| 11 | **Virtual Rewards** | Species sticker album (#730) — each new species grants a sticker | 🟡 Partial (planned) |
| 12 | **Virtual Labels** — Using labels to influence behavior | Rarity badges (common/uncommon/rare/very rare); NOM-059 status on species cards | ✅ Done |
| 13 | **Customization** | Language picker (6+ indigenous languages); observation privacy controls | ✅ Done |
| 14 | **Abstract representation** | Heatmap on profile/map; coverage donut; karma number as progress proxy | 🟡 Partial |
| 15 | **Tailored Virtual Body** | Not applicable (no avatar or virtual body in scope) | — |

### Chapter 5 — Social Actors

| # | Principle | Rastrum Implementation | Status |
|---|-----------|----------------------|--------|
| 16 | **Attractiveness** | Seasonal theme variants (#731); dark/light mode; clean design | 🟡 Partial |
| 17 | **Similarity** | Community wall shows observers from same region; "observers near you" widget | 🟡 Partial |
| 18 | **Praise** | Validation notifications ("Tu observación fue validada"); karma events; badge awards | ✅ Done |
| 19 | **Reciprocity** | Weekly expert-ID lottery for validators (#734) — gives first to get back | ✅ Done |
| 20 | **Authority** | Institutional endorsement badges (#735); credentialed expert badge on validations | ✅ Done |
| 21 | **Social proof** | Community counts ("127 observers in your state this week"); research-grade pill | ✅ Done |
| 22 | **Scarcity** | Expert ID credits limited; lottery model creates scarcity by design | 🟡 Partial |
| 23 | **Competition** | Karma leaderboard; bioblitz ranking | ✅ Done |
| 24 | **Cooperation** | Community validation queue (validators cooperate to reach research grade) | ✅ Done |
| 25 | **Recognition** | Observador del mes (#748); badge wall public; expert credential display | ✅ Done |
| 26 | **Modeling** | "What others in your region observed today" on home page | 🟡 Partial |
| 27 | **Social comparison** | Karma position among followers; leaderboard rank delta | 🟡 Partial |
| 28 | **Normative influence** | "Most observers in your state add a note" microcopy in submit form | ❌ Missing |

### Chapter 6 — Macro-Persuasion

| # | Principle | Rastrum Implementation | Status |
|---|-----------|----------------------|--------|
| 29 | **Incrementing** | Onboarding tour: first obs → first validation → first badge (progressive) | ✅ Done |
| 30 | **Foot-in-the-door** | First Observation Celebration screen; tiny commitments before big ones | ✅ Done |
| 31 | **Door-in-the-face** | Not currently implemented | ❌ Missing |
| 32 | **Low-ball** | Expert apply flow downplays commitment until step 3 | 🟡 Partial |
| 33 | **Legitimization** | "Your data helps researchers" copy on home and export page | 🟡 Partial |
| 34 | **Commitment and consistency** | Streak mechanic; "you've validated 20 obs, keep going" messages | ✅ Done |
| 35 | **Liking** | Pleasant design; indigenous language support; local species focus | 🟡 Partial |
| 36 | **Commitment escalation** | Badge tiers (e.g. 1→10→50→100 species) escalate commitment over time | ✅ Done |
| 37 | **Inoculation** | Not implemented | ❌ Missing |
| 38 | **Priming** | Seasonal chips prime users for what to look for before opening camera | 🟡 Partial |
| 39 | **Anchoring** | Rarity buckets anchor perceived value of rare observations | 🟡 Partial |
| 40 | **Framing** | "Tu dato quedará en el registro científico" — frames obs as scientific contribution | ✅ Done |
| 41 | **Elaboration likelihood** | Expert validation messaging varies by user expertise level | 🟡 Partial |
| 42 | **Peripheral route cues** | Badge icons, karma numbers, streak flames — all peripheral persuasion | ✅ Done |

---

## Focus: 7 Key Principles for Rastrum

These 7 were identified in issue #720 as most impactful for Rastrum's behavior-change goals:

### 1. Tunneling ✅
**Principle:** Using computing technology to guide users through a process or experience provides opportunities to persuade along the way.  
**Rastrum:** Expedition Mode (#722) is the canonical implementation. The 4-stage wizard (Setup → Active → Pause → Summary) tunnels users through a field walk, inserting pre-trip preparation, mid-trip nudges, and a post-trip dopamine hit.  
**Gap:** The onboarding flow doesn't yet tunnel new users from install → first observation in a structured way (done ad-hoc; see #OnboardingTour).

### 2. Tailoring ✅
**Principle:** Tailoring information to individual's needs, interests, personality, usage context, or other factors unique to the individual increases persuasion.  
**Rastrum:** Contextual species chips (#723) tailor suggestions by GPS + season. Falta-dex (#726) tailors the "missing" surface to the user's observed region. Kairos (#724) tailors push prompts to local weather events.  
**Gap:** No tailoring by expertise level in the observation form (novices and experts see the same flow).

### 3. Suggestion ✅
**Principle:** A computing system can increase the likelihood of a target behavior if it offers a suggestion at a propitious moment.  
**Rastrum:** Golden hour push (#724), after-rain push, migration window — all Kairos-timed suggestions. Streak reminder at 9 PM if not yet observed.  
**Gap:** No in-context suggestion when user is near a known hotspot (geofence trigger missing).

### 4. Self-Monitoring ✅
**Principle:** Applying computing technology to eliminate the tedium of tracking performance or status helps people to achieve predetermined goals or outcomes.  
**Rastrum:** Rastrum Wrapped (#725) is the flagship self-monitoring surface. Streak card, karma number, falta-dex gap count, and the daily challenge widget all reinforce self-monitoring without extra effort.  
**Gap:** No weekly email digest of self-monitoring stats (streak digest planned but not shipped).

### 5. Surveillance 🟡
**Principle:** Knowing that one is being observed by others changes behavior toward the observed ideal.  
**Rastrum:** Leaderboard and public profile create light surveillance. Research-grade badge signals that the community watched and agreed on an identification.  
**Gap:** No "your observations are reviewed by X people in your network" visibility. Adding a counter like "3 people validated your last observation" would close this gap.  
**How to implement:** Add a `validators_count` to the observation success screen and profile dex.

### 6. Conditioning ✅
**Principle:** Computing technology can use operant conditioning principles — positive and negative reinforcement, punishment, extinction — to shape user behavior over time.  
**Rastrum:** Badges (positive reinforcement), karma deltas, surprise overlays (#727), streak freeze (punishment avoidance). The system explicitly uses variable-ratio scheduling (surprise badges) which is the strongest conditioning schedule.

### 7. Rehearsal 🟡
**Principle:** Experiencing a behavior in a virtual environment can increase the likelihood of performing the behavior in the real world.  
**Rastrum:** Photo-ID rehearsal mini-game (#729) is the planned implementation but not yet shipped.  
**Gap:** Until #729 ships, new users get no in-app practice before attempting real identifications.  
**How to implement:** A 5-card "Can you identify this?" carousel on the dashboard using known research-grade observations from the community as training data.

---

## Missing Principles — Implementation Notes

### ❌ Normative Influence (#28)
Social norms shape behavior more than most designers realize. Adding small copy like *"La mayoría de observadores en tu región agregan una nota de comportamiento"* at the bottom of the observation form would nudge users to add richer data without explicit prompting.  
**Effort:** 1 day. Copy change + A/B test.

### ❌ Door-in-the-face (#31)
Start with a large request (e.g. "Would you validate 10 observations this week?"), which gets refused, then follow with a smaller request ("Just validate 1?"). Reduces commitment barrier.  
**Effort:** 3 days. Requires notification flow + A/B framework.

### ❌ Inoculation (#37)
Expose users to weak counter-arguments about quitting ("I don't have time to go outside") so they develop resistance. E.g. a streak recovery prompt that pre-emptively addresses "I was too busy."  
**Effort:** 2 days. Copy in streak-broken notification.

---

## Principles Not Applicable to Rastrum

- **Tailored Virtual Body (#15):** No avatar system.
- **Mirror (#5 in actors chapter — not listed):** No real-time feedback mirror.

---

*Last updated: May 2026 — ArtemIO / Rastrum Product Team*
