// Narrative Library built-ins (plan §6.1). `share` is the fraction of runtime each beat gets;
// the shares of a structure sum to 1. Stored here until the library is seeded into the database.

export interface NarrativeBeat {
  key: string;
  act: string;
  name: string;
  purpose: string;
  share: number;
  rules?: string[];
}

export interface NarrativeStructure {
  id: string;
  name: string;
  blurb: string;
  runtime: { min_s: number; max_s: number; default_s: number };
  pace?: { words_per_s: number };
  beats: NarrativeBeat[];
  global_rules: string[];
}

export const NARRATIVES: NarrativeStructure[] = [
  {
    id: "three-act",
    name: "Three-Act",
    blurb: "Setup, confrontation, resolution: the classic shape.",
    runtime: { min_s: 30, max_s: 7200, default_s: 180 },
    beats: [
      { key: "hook", act: "Setup", name: "Opening & hook", purpose: "Show the world and the protagonist; hook the viewer.", share: 0.08 },
      { key: "inciting", act: "Setup", name: "Inciting incident", purpose: "The event that disrupts normal life.", share: 0.08 },
      { key: "plot-point-1", act: "Setup", name: "Plot point 1", purpose: "The protagonist commits; no going back.", share: 0.09 },
      { key: "rising", act: "Confrontation", name: "Rising action", purpose: "Obstacles grow; stakes rise.", share: 0.2 },
      { key: "midpoint", act: "Confrontation", name: "Midpoint", purpose: "A reversal or revelation changes the goal.", share: 0.1 },
      { key: "crisis", act: "Confrontation", name: "Crisis", purpose: "Everything falls apart; the lowest point.", share: 0.2 },
      { key: "climax", act: "Resolution", name: "Climax", purpose: "The final confrontation decides the story.", share: 0.17 },
      { key: "resolution", act: "Resolution", name: "Resolution", purpose: "The new normal; what changed.", share: 0.08 },
    ],
    global_rules: ["Every beat changes the situation.", "The climax answers the question raised by the inciting incident."],
  },
  {
    id: "save-the-cat",
    name: "Save the Cat",
    blurb: "Blake Snyder's 15-beat sheet for character-driven stories.",
    runtime: { min_s: 60, max_s: 7200, default_s: 300 },
    beats: [
      { key: "opening-image", act: "Act 1", name: "Opening image", purpose: "A snapshot of the 'before' world.", share: 0.01 },
      { key: "theme-stated", act: "Act 1", name: "Theme stated", purpose: "Someone hints at the lesson the hero must learn.", share: 0.04 },
      { key: "set-up", act: "Act 1", name: "Set-up", purpose: "Hero, world, flaws and what's missing.", share: 0.05 },
      { key: "catalyst", act: "Act 1", name: "Catalyst", purpose: "The life-changing event.", share: 0.02 },
      { key: "debate", act: "Act 1", name: "Debate", purpose: "The hero hesitates: should I go?", share: 0.08 },
      { key: "break-into-two", act: "Act 2A", name: "Break into two", purpose: "The hero chooses the new world.", share: 0.02 },
      { key: "b-story", act: "Act 2A", name: "B story", purpose: "A relationship that carries the theme.", share: 0.03 },
      { key: "fun-and-games", act: "Act 2A", name: "Fun and games", purpose: "The promise of the premise, explored.", share: 0.23 },
      { key: "midpoint", act: "Act 2A", name: "Midpoint", purpose: "False victory or false defeat; stakes rise.", share: 0.02 },
      { key: "bad-guys-close-in", act: "Act 2B", name: "Bad guys close in", purpose: "Doubt and enemies tighten the noose.", share: 0.23 },
      { key: "all-is-lost", act: "Act 2B", name: "All is lost", purpose: "The opposite of the midpoint; a 'whiff of death'.", share: 0.02 },
      { key: "dark-night", act: "Act 2B", name: "Dark night of the soul", purpose: "The hero processes the loss.", share: 0.05 },
      { key: "break-into-three", act: "Act 3", name: "Break into three", purpose: "The hero finds the solution, thanks to the B story.", share: 0.02 },
      { key: "finale", act: "Act 3", name: "Finale", purpose: "The hero applies the lesson and wins.", share: 0.17 },
      { key: "final-image", act: "Act 3", name: "Final image", purpose: "The 'after' snapshot, mirroring the opening.", share: 0.01 },
    ],
    global_rules: ["The final image mirrors the opening image.", "The B story delivers the theme."],
  },
  {
    id: "heros-journey",
    name: "Hero's Journey",
    blurb: "Twelve stages of departure, initiation and return.",
    runtime: { min_s: 60, max_s: 7200, default_s: 300 },
    beats: [
      { key: "ordinary-world", act: "Departure", name: "Ordinary world", purpose: "The hero's normal life.", share: 0.07 },
      { key: "call", act: "Departure", name: "Call to adventure", purpose: "A problem or challenge appears.", share: 0.06 },
      { key: "refusal", act: "Departure", name: "Refusal of the call", purpose: "Fear makes the hero hesitate.", share: 0.05 },
      { key: "mentor", act: "Departure", name: "Meeting the mentor", purpose: "Advice, training or a gift.", share: 0.06 },
      { key: "threshold", act: "Departure", name: "Crossing the threshold", purpose: "The hero enters the special world.", share: 0.06 },
      { key: "tests", act: "Initiation", name: "Tests, allies, enemies", purpose: "The hero learns the rules of the new world.", share: 0.14 },
      { key: "approach", act: "Initiation", name: "Approach", purpose: "Preparing for the central ordeal.", share: 0.08 },
      { key: "ordeal", act: "Initiation", name: "Ordeal", purpose: "The biggest test; a symbolic death.", share: 0.12 },
      { key: "reward", act: "Initiation", name: "Reward", purpose: "The hero seizes the prize.", share: 0.08 },
      { key: "road-back", act: "Return", name: "The road back", purpose: "Consequences chase the hero home.", share: 0.09 },
      { key: "resurrection", act: "Return", name: "Resurrection", purpose: "A final test proves the change.", share: 0.12 },
      { key: "elixir", act: "Return", name: "Return with the elixir", purpose: "The hero brings something back.", share: 0.07 },
    ],
    global_rules: ["The hero is transformed by the end."],
  },
  {
    id: "kishotenketsu",
    name: "Kishōtenketsu",
    blurb: "Four parts built on a twist, not on conflict.",
    runtime: { min_s: 15, max_s: 3600, default_s: 90 },
    beats: [
      { key: "ki", act: "Ki", name: "Introduction", purpose: "Introduce characters and setting.", share: 0.25 },
      { key: "sho", act: "Shō", name: "Development", purpose: "Develop what was introduced, without a major change.", share: 0.25 },
      { key: "ten", act: "Ten", name: "Twist", purpose: "An unexpected development recasts everything.", share: 0.25 },
      { key: "ketsu", act: "Ketsu", name: "Reconciliation", purpose: "Tie the twist back to the first two parts.", share: 0.25 },
    ],
    global_rules: ["Avoid relying on conflict; the twist creates the interest."],
  },
  {
    id: "fact-short",
    name: "Fact short",
    blurb: "A 55–70 s story about one surprising true fact.",
    runtime: { min_s: 55, max_s: 70, default_s: 62 },
    pace: { words_per_s: 3.7 },
    beats: [
      { key: "hook", act: "Hook", name: "Hook", purpose: "The absurd fact in one line.", share: 0.07, rules: ["One line."] },
      { key: "setting", act: "Story", name: "Setting", purpose: "Year, place, pride.", share: 0.1 },
      { key: "escalation", act: "Story", name: "Escalation", purpose: "Three or four beats, each a little bigger.", share: 0.25, rules: ["3–4 escalations, each bigger."] },
      { key: "snap", act: "Story", name: "Snap", purpose: "The moment it breaks.", share: 0.08 },
      { key: "deadpan", act: "Story", name: "Deadpan double", purpose: "'Luckily… / Unluckily…'", share: 0.08 },
      { key: "analogy", act: "Explain", name: "Explanation by analogy", purpose: "One idea through an everyday analogy.", share: 0.2 },
      { key: "consequence", act: "Explain", name: "Consequence", purpose: "The rule it created.", share: 0.12 },
      { key: "callback", act: "Ending", name: "Callback twist", purpose: "The ending calls back to the hook.", share: 0.1 },
    ],
    global_rules: ["Never narrate what the viewer already sees.", "Jokes are real, researched facts."],
  },
];

export const CUSTOM_NARRATIVE_ID = "custom";

export const narrativeById = (id: string) => NARRATIVES.find((n) => n.id === id);

/** Scene presets offered at the Idea stage. Their numeric camera grammar lands in milestone 6. */
export const SCENE_PRESETS = [
  { id: "continuous-glide", name: "Continuous glide", blurb: "Smooth glides, creeping push-ins, cuts on big jumps." },
  { id: "motion-graphics", name: "Motion graphics", blurb: "Kinetic type, shape layers and on-beat transitions." },
] as const;
