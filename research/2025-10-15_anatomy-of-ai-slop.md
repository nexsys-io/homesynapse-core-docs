# The Anatomy of AI Slop and How to Avoid It

**Type:** Research artifact
**Origin:** Foundational research for DAS voice and tone guidelines
**Produced:** 2025 (extracted from conversation context 2026-03-08)
**Status:** Reference — informs DAS vocabulary rules, Vale linting configuration, and all external-facing content standards
**Downstream dependents:** DAS_Consolidated_Reference_v1.md (vocabulary section, four amendments), Vale CI rules, Doc 13 Web UI content, all homesynapse.com documentation

---

## Why This Document Matters for HomeSynapse

The DAS Consolidated Reference bans specific vocabulary patterns and mandates structural variety in all external-facing content. This document contains the empirical basis for those rules. Any agent producing documentation, website content, or UI copy needs to understand not just *what* is banned but *why* — because the distinction between "robust error handling for network timeouts" (precise, keep it) and "a robust and comprehensive solution" (decorative, cut it) requires understanding the underlying principle, not just matching a word list.

The four DAS amendments (AI-associated vocabulary ban, softened leverage exception, specificity principle, structural variety requirement) were derived directly from this research.

---

## The Empirical Fingerprint of LLM-Generated Text

Three major studies have mapped the linguistic signature of AI writing with unusual rigor.

**Kobak et al. (University of Tubingen, Science Advances, 2024):** Analyzed vocabulary shifts across 14.2 million PubMed abstracts from 2010-2024. Method borrowed from epidemiology — computing "excess word usage" the same way researchers compute excess mortality. Found 280 style words with elevated frequencies in post-ChatGPT writing. The word "delves" appears 25 times more frequently than expected. The effect was unprecedented: no prior event in scientific publishing, including the COVID pandemic, had shifted vocabulary this dramatically. Finding: at least 10% of all 2024 scientific abstracts were processed through LLMs.

**Liang et al. (Stanford, ICML 2024):** Found the same pattern in AI conference peer reviews. "Meticulous" saw a 34.7-fold increase, "intricate" an 11.2-fold increase, "commendable" a 9.8-fold increase at ICLR 2024. Critical insight: adjectives are the most diagnostic part of speech — more stable markers than verbs, nouns, or adverbs.

**Desaire (University of Kansas):** Achieved 99% classification accuracy between human and AI text using just 20 features. The most discriminating were structural properties, not vocabulary: sentence-length variance (humans write both very short and very long sentences; AI clusters around medium lengths), paragraph length (humans write longer paragraphs), punctuation diversity (humans use more dashes, semicolons, question marks, parentheses), and specificity (humans name specific researchers, cite exact numbers, use acronyms; AI refers generically to "researchers" and "others").

**Convergence finding:** The LLM fingerprint is primarily visible in style rather than content. The words AI overuses are not technical terms but decorative ones — adjectives, adverbs, and discourse markers that convey tone rather than information.

---

## The Vocabulary Taxonomy

### Tier 1: Highest-signal markers

**"Delve"** — The single most notorious AI marker. Origin: OpenAI and other companies outsource RLHF annotation to workers in Nigeria and other African nations, where "delve" is standard formal English. Annotators who naturally used and favored this word inadvertently trained models to overuse it. This RLHF mechanism (documented by The Guardian, confirmed in academic literature) explains much of the vocabulary bias. Confirmed by Juzek and Ward at COLING 2025 as a statistical outlier.

### Tier 2: Category clusters

**Grandiose nouns:** "tapestry," "realm," "landscape," "beacon," "symphony," "testament" — metaphorical inflation.

**Intensifying adjectives:** "pivotal," "crucial," "meticulous," "intricate," "robust," "comprehensive," "nuanced," "vibrant," "seamless" — vague amplifiers rather than precise descriptors.

**Formal verbs:** "embark," "foster," "leverage," "harness," "underscore," "showcase," "illuminate" — needlessly elevated diction replacing simpler alternatives ("start," "encourage," "use," "emphasize," "show").

**Mechanical transitions:** "moreover," "furthermore," "additionally," "it's worth noting that," "in conclusion" — verbal glue rather than genuine logical connection.

### Why these specific words trigger backlash

Three reasons, all empirically grounded:

1. **Statistically anomalous** — appearing at frequencies that deviate sharply from pre-2023 baselines in large corpora
2. **Appear in combination without substantiation** — a paragraph containing "robust," "comprehensive," and "leveraging" that provides no specific details practically announces its origin
3. **Represent a specific register** — formal-but-hollow — that exists in AI output because RLHF training rewards impressive-sounding language over precise language

---

## Structural Patterns (More Diagnostic Than Vocabulary)

### Gorrie (Dead Language Society, July 2025)

Central observation: LLMs write like someone who just learned about sophisticated rhetorical devices and cannot resist using them everywhere.

**Compulsive parallelism:** The "it's not X, it's Y" construction — creates the illusion of insight by pretending to negate something. AI deploys antithesis indiscriminately, using Churchillian cadences for customer support emails.

**Tricolon abuse:** "Fast, efficient, and reliable"; "think bigger, act bolder, move faster." Humans use tricolon selectively for emphasis. AI uses it as a default rhythm, which paradoxically drains it of power.

**Formulaic paragraph architecture:** Rigid claim-elaboration-summary pattern. Introductions that preview everything. Conclusions that restate everything. The most elementary version of the five-paragraph essay.

### Absence-based markers

AI text systematically lacks:
- **Sentence-length variance** — humans mix very short and very long sentences; AI hovers around medium lengths
- **Genuine uncertainty** — AI hedges formulaically with "it's important to note" rather than expressing authentic doubt
- **Personal specificity** — no anecdotes, no named sources, no idiosyncratic cultural references
- **Tonal variation** — consistent register and point of view where human writers naturally shift

### Guo ("Field Guide to AI Slop," October 2025)

The most damaging pattern: surface polish with nothing underneath. Readers encounter text that is grammatically pristine and structurally organized, yet when they try to extract the actual argument, there is none. This is Bajohr's "cohesion without coherence" — text that has all the formal markers of meaningful prose without actually containing meaning.

---

## Reader Perception Research

**The detection paradox:** Humans detect AI-generated text at roughly 53% accuracy — barely above random guessing (Penn State experiments). Even training doesn't significantly improve this. Yet when AI authorship is disclosed, perception shifts are consistently negative: a controlled study with 261 participants (IUI '26) found drops in trust, perceived caring, competence, and likability across all writing tasks, with strongest effects in interpersonal contexts.

**The uncanny valley for text:** Radivojevic et al. (2024) documented the same phenomenon known from robotics — near-but-not-quite-human stimuli produce discomfort. Kishnani (MIT thesis, 2025) found 60% of participants mistook a human writer for GPT while 40% mistook GPT for human, but participants consistently expressed preference for "naturalness, human imperfections, and vulnerability."

**What triggers the uncanny valley:** Not any single feature but a constellation. Excessive polish combined with vague claims. Confident tone without specific evidence. Emotional language that never varies in intensity. Perfect grammar in contexts where informality would be natural. The absence of rough edges that signal genuine cognitive effort.

**For technical documentation specifically:** Specificity is the primary trust signal. Exact endpoint descriptions, real error codes, tested code samples, documented edge cases are inherently difficult to fake and immediately communicate human expertise. "Seamlessly integrates with your smart home ecosystem" does the opposite.

---

## Practical Defenses

### Existing style guide alignment

Google Developer Documentation Style Guide and Microsoft Writing Style Guide naturally counter the problem. Google: active voice, second person ("you"), present tense, simple words ("use" not "utilize"), shorter sentences. Microsoft: "bigger ideas, fewer words," writing that sounds like speech. Both guides, applied rigorously, produce text that resists the most common AI patterns.

### Vale linting rules (actionable for HomeSynapse DAS CI)

No dedicated AI-slop Vale package exists yet, but custom rules can target known patterns:
- Flag vague intensifiers ("robust," "comprehensive," "seamless") when not followed by specific technical detail within the same sentence or paragraph
- Flag known AI opener constructions ("In today's," "In the ever-evolving," "It's worth noting")
- Enforce maximum sentence-length thresholds and flag uniform sentence-length distributions
- Flag "utilize" and "leverage" where "use" would suffice (except in documented technical senses)
- Flag excessive em-dash usage (tripled on Reddit after ChatGPT's launch)

### Descript "7 Rules" framework

Define your voice first. Write main points yourself before engaging AI. Use AI as a thought partner rather than a ghostwriter. Fact-check everything. Replace every generality with a specific. Cut 30% of any AI-generated draft (most AI output contains that much filler).

---

## The Critical Nuance: When "AI Slop" Words Are Correct

Banning vocabulary is the wrong approach. The distinguishing principle is **specificity versus vagueness**.

- "Robust to Byzantine faults" — specific, technical, irreplaceable. Keep it.
- "Robust error handling for network timeouts, malformed payloads, and authentication failures" — specific, enumerative. Keep it.
- "A robust and comprehensive solution" — decorative, vague. Cut it.
- "Comprehensive test coverage exercising every code path" — measurable claim. Keep it.
- "Leverage" conveying strategic exploitation of an existing capability — distinct from "use." Keep it.
- "Leverage" as a synonym for "use" — cut it.

The Google Developer Documentation Style Guide captures this precisely: don't use "leverage" when you mean "use," but it's fine when conveying a special sense.

**The test:** Does removing this word and substituting a simpler one lose technical precision? If yes, keep it. If the word merely adds apparent sophistication to a vague claim, cut it.

**For HomeSynapse:** Write "connects to Home Assistant via MQTT on port 1883" rather than "seamlessly integrates with your smart home ecosystem." Document what happens when WiFi drops during a firmware update, how devices behave during power outages, and what specific Zigbee, Z-Wave, or Matter protocols are supported. The words themselves aren't the disease. The disease is using impressive words as substitutes for actual information.

---

## Three Novel Insights

1. **RLHF labor practices create vocabulary bias.** The "delve" problem reveals that AI vocabulary biases are artifacts of specific annotation labor practices, not inherent model limitations. They will shift as training methods change, making word-list-based detection a moving target. The DAS must be periodically updated.

2. **"Cohesion without coherence" is the structural signature.** The model generates locally connected text without global argumentative architecture, producing prose that reads like an essay but functions like a word cloud. The fix cannot be cosmetic vocabulary swaps — it must address the underlying monotony of rhythm, structure, and specificity.

3. **The uncanny valley for text operates below conscious awareness.** Readers react to AI writing's statistical uniformity before they can articulate what bothers them. This means HomeSynapse documentation must achieve genuine naturalness, not just avoid flagged words.

---

## Conclusion: Specificity as the Ultimate Defense

The most reliable defense against AI-slop perception is writing that contains information AI cannot generate — specific technical details, real edge cases, genuine design rationale, and domain expertise that comes from building and debugging actual systems. The vocabulary lists and structural patterns are useful diagnostics, but they address symptoms rather than causes. The cause is text optimized for surface impressiveness rather than reader utility.

Build editorial processes that enforce specificity at every level: Vale linting for vocabulary precision, peer review for substantive technical accuracy, and a style guide that demands concrete evidence behind every claim. The goal is not to avoid sounding like AI. The goal is to write so precisely and knowledgeably that the question never arises.
