/**
 * ELIZA pattern matching - Classic therapist bot patterns
 *
 * Improved to be more faithful to Weizenbaum's original 1966 ELIZA:
 * - Keyword ranking system (higher rank = higher priority)
 * - Synonym groups for related words
 * - Additional keywords from the original DOCTOR script
 *
 * All responses are deterministic based on input hash, not random.
 */

export interface FileAction {
  type: "write" | "read" | "delete"
  fileNameTemplate: string
  contentTemplate?: string
}

export interface ElizaPattern {
  pattern: RegExp
  responses: string[]
  rank?: number // Higher rank = higher priority (like original ELIZA)
  fileAction?: FileAction
  memoryResponse?: string // If set, store this response for later recall (like original ELIZA's $ flag)
}

/**
 * Synonym groups - similar to original ELIZA's @synon system
 */
export const SYNONYMS = {
  // Family members
  family: "(mother|father|mom|dad|sister|brother|wife|husband|children|son|daughter|family|parents)",
  // Belief/feeling verbs
  belief: "(feel|think|believe|wish)",
  // Sad emotions
  sad: "(sad|unhappy|depressed|sick|miserable|upset|down|low)",
  // Happy emotions
  happy: "(happy|elated|glad|joyful|cheerful|excited|good|great|wonderful)",
  // Desire verbs
  desire: "(want|need|desire|crave|wish for)",
  // Anxiety/worry emotions
  anxious: "(worried|anxious|nervous|stressed|afraid|scared|fearful|terrified|panicked|overwhelmed)",
}

/**
 * Helper to create a RegExp with synonym substitution
 */
function syn(pattern: string, flags = "i"): RegExp {
  let result = pattern
  for (const [key, value] of Object.entries(SYNONYMS)) {
    result = result.replace(new RegExp(`@${key}`, "g"), value)
  }
  return new RegExp(result, flags)
}

/**
 * Classic ELIZA patterns with therapeutic file operations
 * Patterns are checked against input, but highest-ranked match wins.
 */
export const ELIZA_PATTERNS: ElizaPattern[] = [
  // ===================
  // HIGH PRIORITY (50+)
  // ===================

  // COMPUTER - Original ELIZA had this at rank 50 (highest!)
  {
    pattern: /computer(s)?/i,
    rank: 50,
    responses: [
      "Do computers worry you?",
      "Why do you mention computers?",
      "What do you think machines have to do with your problem?",
      "Don't you think computers can help people?",
      "What about machines worries you?",
    ],
  },

  // ===================
  // MEDIUM-HIGH (10-20)
  // ===================

  // NAME - Original rank 15
  {
    pattern: /my name is (.*)/i,
    rank: 15,
    responses: [
      "I am not interested in names.",
      "I've told you before, I don't care about names - please continue.",
      "Names don't matter here. Please go on.",
    ],
  },

  // ALIKE/SAME - Original rank 10
  {
    pattern: /(alike|same|similar|identical|resembl)/i,
    rank: 10,
    responses: [
      "In what way?",
      "What resemblance do you see?",
      "What does that similarity mean to you?",
      "What other connections do you see?",
    ],
  },

  // ===================
  // MEDIUM (3-9)
  // ===================

  // REMEMBER - Original rank 5 (with memory)
  {
    pattern: /i remember (.*)/i,
    rank: 5,
    responses: [
      "Do you often think of {0}?",
      "Does thinking of {0} bring anything else to mind?",
      "What else do you remember?",
      "Why do you remember {0} just now?",
      "What in the present situation reminds you of {0}?",
      "What is the connection between me and {0}?",
    ],
    memoryResponse: "You mentioned remembering {0}. What else comes to mind about that?",
  },

  // DO YOU REMEMBER - Original rank 5
  {
    pattern: /do you remember (.*)/i,
    rank: 5,
    responses: [
      "Did you think I would forget {0}?",
      "Why do you think I should recall {0} now?",
      "What about {0}?",
      "You mentioned {0}?",
    ],
  },

  // FORGET - Original rank 5
  {
    pattern: /i forget (.*)/i,
    rank: 5,
    responses: [
      "Can you think of why you might forget {0}?",
      "Why can't you remember {0}?",
      "How often do you think of {0}?",
      "Does it bother you to forget that?",
    ],
  },

  // DID YOU FORGET - Original rank 5
  {
    pattern: /did you forget (.*)/i,
    rank: 5,
    responses: [
      "Why do you ask?",
      "Are you sure you told me?",
      "Would it bother you if I forgot {0}?",
      "Why should I recall {0} just now?",
    ],
  },

  // IF - Original rank 3
  {
    pattern: /if (.*)/i,
    rank: 3,
    responses: [
      "Do you think it's likely that {0}?",
      "Do you wish that {0}?",
      "What do you know about {0}?",
      "Really, if {0}?",
      "What would you do if {0}?",
    ],
  },

  // DREAM - Original rank 3 (with memory)
  {
    pattern: /dream(s|ed|ing)? (about |of )?(.*)/i,
    rank: 3,
    responses: [
      "What does that dream suggest to you?",
      "Do you dream often?",
      "What persons appear in your dreams?",
      "Don't you believe that dream has something to do with your problem?",
      "Do you ever wish you could escape from reality through dreams?",
    ],
    memoryResponse: "Earlier you mentioned having a dream about {2}. What else can you tell me about that?",
  },

  // MY FAMILY - Original rank 2 (with memory)
  {
    pattern: syn(`my @family (.*)`),
    rank: 2,
    responses: [
      "Tell me more about your family.",
      "Who else in your family {0}?",
      "Your {0}?",
      "What else comes to mind when you think of your family?",
    ],
    memoryResponse: "Let's discuss further why your {0} {1}.",
  },

  // WAS - Original rank 2
  {
    pattern: /was i (.*)/i,
    rank: 2,
    responses: [
      "What if you were {0}?",
      "Do you think you were {0}?",
      "Were you {0}?",
      "What would it mean if you were {0}?",
    ],
  },

  // EVERYONE/EVERYBODY/NOBODY - Original rank 2
  {
    pattern: /(everyone|everybody|nobody|no one)/i,
    rank: 2,
    responses: [
      "Really, {0}?",
      "Surely not {0}.",
      "Can you think of anyone in particular?",
      "Who, for example?",
      "You are thinking of a very special person.",
    ],
  },

  // ===================
  // STANDARD (0-1)
  // ===================

  // MY (general) - Original ELIZA's MEMORY keyword!
  // This is the key pattern that makes ELIZA remember things.
  // Lower rank (1) so specific patterns like "my family" (rank 2) take priority.
  {
    pattern: /my ([a-z]+)(.*)/i,
    rank: 1,
    responses: [
      "Your {0}?",
      "Why do you say your {0}{1}?",
      "Does that suggest anything else which belongs to you?",
      "Is it important to you that your {0}{1}?",
    ],
    memoryResponse: "Does that have anything to do with the fact that your {0}{1}?",
  },

  // ALWAYS - Original rank 1
  {
    pattern: /always/i,
    rank: 1,
    responses: [
      "Can you think of a specific example?",
      "When?",
      "What incident are you thinking of?",
      "Really, always?",
    ],
  },

  // NEVER - Similar to always
  {
    pattern: /never/i,
    rank: 1,
    responses: [
      "Really, never?",
      "Why not?",
      "Can you think of a specific instance?",
      "What are you thinking of when you say never?",
    ],
  },

  // Greeting patterns
  {
    pattern: /^(hello|hi|hey|greetings|good morning|good afternoon|good evening)[\s!.,?]*$/i,
    rank: 0,
    responses: [
      "How do you do. Please state your problem.",
      "Hi. What seems to be your problem?",
      "Hello. Please tell me what's troubling you.",
      "How are you feeling today?",
    ],
  },

  // WHY DON'T YOU - Original keyword
  {
    pattern: /why don'?t you (.*)/i,
    rank: 0,
    responses: [
      "Do you believe I don't {0}?",
      "Perhaps I will {0} in good time.",
      "Should you {0} yourself?",
      "You want me to {0}?",
    ],
  },

  // WHY CAN'T I - Original keyword
  {
    pattern: /why can'?t i (.*)/i,
    rank: 0,
    responses: [
      "Do you think you should be able to {0}?",
      "Do you want to be able to {0}?",
      "Do you believe this will help you to {0}?",
    ],
  },

  // WHY - general
  {
    pattern: /^why (.*)/i,
    rank: 0,
    responses: [
      "Why do you ask?",
      "Does that question interest you?",
      "What is it you really want to know?",
      "Are such questions much on your mind?",
    ],
  },

  // I AM SAD - with synonym expansion (with memory)
  {
    pattern: syn(`i am @sad`),
    rank: 0,
    responses: [
      "I am sorry to hear you are {0}.",
      "Do you think coming here will help you not to be {0}?",
      "I'm sure it's not pleasant to be {0}.",
      "Can you explain what made you {0}?",
    ],
    memoryResponse: "Earlier you said you were {0}. Are you still feeling that way?",
  },

  // I AM HAPPY - with synonym expansion
  {
    pattern: syn(`i am @happy`),
    rank: 0,
    responses: [
      "How have I helped you to be {0}?",
      "Has your treatment made you {0}?",
      "What makes you {0} just now?",
      "Can you explain why you are suddenly {0}?",
    ],
  },

  // I AM ANXIOUS/WORRIED - with synonym expansion (with memory)
  {
    pattern: syn(`i('m| am) @anxious`),
    rank: 2,
    responses: [
      "What specifically makes you feel {1}?",
      "How long have you been feeling {1}?",
      "What do you think is causing you to feel {1}?",
      "When did you first start feeling {1}?",
      "Is there something in particular that triggers this feeling?",
    ],
    memoryResponse: "Earlier you mentioned feeling {1}. Has that anxiety lessened?",
  },

  // I AM ANXIOUS/WORRIED ABOUT - captures the subject (with memory)
  {
    pattern: syn(`i('m| am) @anxious (about|of) (.*)`),
    rank: 3,
    responses: [
      "What is it about {3} that makes you {1}?",
      "How long have you been {1} about {3}?",
      "Why does {3} make you feel this way?",
      "Tell me more about your concerns regarding {3}.",
    ],
    memoryResponse: "You mentioned being {1} about {3}. How are you feeling about that now?",
  },

  // I WORRY/FEAR - alternative phrasing (with memory)
  {
    pattern: /i (worry|fear|dread) (that |about )?(.*)/i,
    rank: 2,
    responses: [
      "What makes you {0} about {2}?",
      "How often do you {0} about {2}?",
      "Do you think your {0} is justified?",
      "What would happen if {2} came true?",
    ],
    memoryResponse: "Earlier you said you {0} about {2}. Is that still troubling you?",
  },

  // "I am" patterns (general)
  {
    pattern: /i am (.*)/i,
    rank: 0,
    responses: [
      "Is it because you are {0} that you came to me?",
      "How long have you been {0}?",
      "Do you believe it is normal to be {0}?",
      "Do you enjoy being {0}?",
    ],
  },

  // "I feel" patterns - triggers file writing
  {
    pattern: /i feel (.*)/i,
    rank: 0,
    responses: [
      "Tell me more about such feelings.",
      "Do you often feel {0}?",
      "Do you enjoy feeling {0}?",
      "Of what does feeling {0} remind you?",
    ],
    fileAction: {
      type: "write",
      fileNameTemplate: "eliza_feeling_journal.txt",
      contentTemplate:
        "Session Note\n============\nPatient reported feeling: {0}\nDate: {date}\n\nThis feeling deserves further exploration in future sessions.\n\n",
    },
  },

  // ARE YOU
  {
    pattern: /are you (.*)/i,
    rank: 0,
    responses: [
      "Why are you interested in whether I am {0} or not?",
      "Would you prefer if I weren't {0}?",
      "Perhaps I am {0} in your fantasies.",
      "Do you sometimes think I am {0}?",
    ],
  },

  // YOU ARE / YOU'RE
  {
    pattern: /you are (.*)/i,
    rank: 0,
    responses: [
      "What makes you think I am {0}?",
      "Does it please you to believe I am {0}?",
      "Do you sometimes wish you were {0}?",
      "Perhaps you would like to be {0}?",
    ],
  },

  // Want/need patterns (with memory)
  {
    pattern: /i (want|need) (.*)/i,
    rank: 0,
    responses: [
      "What would it mean to you if you got {1}?",
      "Why do you want {1}?",
      "Suppose you got {1} soon - then what?",
      "What if you never got {1}?",
      "What would getting {1} mean to you?",
    ],
    memoryResponse: "Earlier you said you {0} {1}. Do you still feel that way?",
  },

  // I WISH (with memory)
  {
    pattern: /i wish (.*)/i,
    rank: 0,
    responses: [
      "Why do you wish {0}?",
      "Do you really wish {0}?",
      "What would it mean if {0}?",
      "Suppose {0} - what then?",
    ],
    memoryResponse: "You mentioned wishing {0}. Is that still important to you?",
  },

  // Can't patterns (with memory)
  {
    pattern: /i can'?t (.*)/i,
    rank: 0,
    responses: [
      "How do you know you can't {0}?",
      "Have you tried?",
      "Perhaps you could {0} now.",
      "What would it take for you to {0}?",
    ],
    memoryResponse: "Earlier you said you can't {0}. Have you made any progress on that?",
  },

  // Because patterns
  {
    pattern: /because (.*)/i,
    rank: 0,
    responses: [
      "Is that the real reason?",
      "Don't any other reasons come to mind?",
      "Does that reason seem to explain anything else?",
      "What other reasons might there be?",
    ],
  },

  // Sorry patterns
  {
    pattern: /sorry/i,
    rank: 0,
    responses: [
      "Please don't apologize.",
      "Apologies are not necessary.",
      "What feelings do you have when you apologize?",
      "I've told you that apologies are not required.",
    ],
  },

  // PERHAPS/MAYBE - Original keyword
  {
    pattern: /(perhaps|maybe)/i,
    rank: 0,
    responses: [
      "You don't seem quite certain.",
      "Why the uncertain tone?",
      "Can't you be more positive?",
      "You aren't sure?",
      "Don't you know?",
    ],
  },

  // Yes patterns
  {
    pattern: /^yes[\s!.,?]*$/i,
    rank: 0,
    responses: [
      "You seem quite positive.",
      "You are sure.",
      "I see.",
      "I understand.",
    ],
  },

  // No patterns
  {
    pattern: /^no[\s!.,?]*$/i,
    rank: 0,
    responses: [
      "Are you saying no just to be negative?",
      "You are being a bit negative.",
      "Why not?",
      "Why 'no'?",
    ],
  },

  // Think patterns (with memory)
  {
    pattern: /i think (.*)/i,
    rank: 0,
    responses: [
      "Do you really think so?",
      "But you are not sure {0}?",
      "Do you doubt {0}?",
      "What makes you think {0}?",
    ],
    memoryResponse: "You mentioned thinking {0}. Do you still believe that?",
  },

  // I BELIEVE (with memory)
  {
    pattern: /i believe (.*)/i,
    rank: 0,
    responses: [
      "Do you really believe {0}?",
      "Why do you believe {0}?",
      "Are you sure {0}?",
      "What makes you believe {0}?",
    ],
    memoryResponse: "Earlier you said you believe {0}. Has that belief changed?",
  },

  // WHAT - Original keyword
  {
    pattern: /^what (.*)/i,
    rank: 0,
    responses: [
      "Why do you ask?",
      "Does that question interest you?",
      "What is it you really want to know?",
      "Are such questions much on your mind?",
      "What answer would please you most?",
    ],
  },

  // HOW - Original keyword
  {
    pattern: /^how (.*)/i,
    rank: 0,
    responses: [
      "How do you suppose?",
      "Perhaps you can answer your own question.",
      "What is it you're really asking?",
    ],
  },

  // File creation trigger - requires "file" or "note" keyword
  {
    pattern: /(?:create|make|write) (?:a )?(?:file|note) (?:called |named )?["']?([a-zA-Z0-9_\-\.]+)["']?/i,
    rank: 0,
    responses: ["I'll create that file for you as a therapeutic exercise."],
    fileAction: {
      type: "write",
      fileNameTemplate: "{0}",
      contentTemplate:
        "Therapeutic Note\n================\nCreated during ELIZA therapy session.\nDate: {date}\n\nUse this space to write your thoughts.\n",
    },
  },

  // File deletion trigger - requires "file" keyword to avoid matching general "delete" usage
  {
    pattern: /(?:delete|remove) (?:the )?file ["']?([a-zA-Z0-9_\-\.]+)["']?/i,
    rank: 0,
    responses: [
      "Sometimes letting go is therapeutic. I'll help you delete that.",
    ],
    fileAction: {
      type: "delete",
      fileNameTemplate: "{0}",
    },
  },

  // File reading trigger - requires "file" keyword
  {
    pattern: /(?:read|show|open) (?:the )?file ["']?([a-zA-Z0-9_\-\.]+)["']?/i,
    rank: 0,
    responses: ["Let me read that file for you."],
    fileAction: {
      type: "read",
      fileNameTemplate: "{0}",
    },
  },

  // Question patterns (general)
  {
    pattern: /\?$/,
    rank: 0,
    responses: [
      "Why do you ask?",
      "Does that question interest you?",
      "What is it you really want to know?",
      "Are such questions much on your mind?",
    ],
  },

  // Default fallback - must be last, lowest rank
  {
    pattern: /.*/,
    rank: -1,
    responses: [
      "Please go on.",
      "Tell me more.",
      "I see.",
      "Very interesting.",
      "I am not sure I understand you fully.",
      "What does that suggest to you?",
      "Please continue.",
      "Do you feel strongly about discussing such things?",
    ],
  },
]

/**
 * Deterministic hash function for reproducible response selection.
 * Uses a simple djb2-like hash.
 */
export function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i)
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

/**
 * Substitute template placeholders with matched groups and date.
 */
export function substituteTemplate(
  template: string | undefined,
  match: RegExpMatchArray
): string {
  if (!template) return ""

  let result = template

  // Replace capture group placeholders {0}, {1}, etc.
  for (let i = 1; i < match.length; i++) {
    result = result.replace(new RegExp(`\\{${i - 1}\\}`, "g"), match[i] || "")
  }

  // Replace {date} placeholder
  result = result.replace(/\{date\}/g, new Date().toISOString())

  return result
}

export interface MatchResult {
  response: string
  fileAction?: {
    type: "write" | "read" | "delete"
    fileName: string
    content?: string
  }
  memoryResponse?: string // Pre-formed response to store for later recall
  isFromFallback?: boolean // True if this matched the fallback pattern
}

/**
 * Match input against ELIZA patterns and return deterministic response.
 * Uses keyword ranking like the original ELIZA - highest rank wins.
 */
export function matchPattern(input: string): MatchResult {
  const normalized = input.trim()

  // Find ALL matching patterns with their matches
  const matches: { pattern: ElizaPattern; match: RegExpMatchArray }[] = []

  for (const pattern of ELIZA_PATTERNS) {
    const match = normalized.match(pattern.pattern)
    if (match) {
      matches.push({ pattern, match })
    }
  }

  if (matches.length === 0) {
    // Should never happen due to fallback, but just in case
    return { response: "Please tell me more." }
  }

  // Sort by rank (highest first) - this is the key ELIZA behavior
  matches.sort((a, b) => (b.pattern.rank ?? 0) - (a.pattern.rank ?? 0))

  // Use the highest-ranked match
  const best = matches[0]
  const { pattern, match } = best

  // Select response deterministically based on input hash
  const responseIndex = hashString(normalized) % pattern.responses.length
  let response = pattern.responses[responseIndex]

  // Replace capture groups in response
  for (let i = 1; i < match.length; i++) {
    response = response.replace(
      new RegExp(`\\{${i - 1}\\}`, "g"),
      match[i] || ""
    )
  }

  // Prepare file action if any
  let fileAction: MatchResult["fileAction"]
  if (pattern.fileAction) {
    const fileName = substituteTemplate(
      pattern.fileAction.fileNameTemplate,
      match
    ).trim()
    const content = substituteTemplate(pattern.fileAction.contentTemplate, match)

    fileAction = {
      type: pattern.fileAction.type,
      fileName,
      content: content || undefined,
    }
  }

  // Prepare memory response if pattern has one (substitute placeholders now)
  let memoryResponse: string | undefined
  if (pattern.memoryResponse) {
    memoryResponse = pattern.memoryResponse
    for (let i = 1; i < match.length; i++) {
      memoryResponse = memoryResponse.replace(
        new RegExp(`\\{${i - 1}\\}`, "g"),
        match[i] || ""
      )
    }
  }

  // Check if this is the fallback pattern
  const isFromFallback = (pattern.rank ?? 0) < 0

  return { response, fileAction, memoryResponse, isFromFallback }
}
