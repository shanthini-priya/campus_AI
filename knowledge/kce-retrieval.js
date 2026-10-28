/* ==========================================================================
   KCE local retrieval engine
   --------------------------------------------------------------------------
   This is a deterministic keyword/relevance retrieval engine. It is NOT a
   generative AI model. It reads the verified local knowledge base
   (knowledge/kce-knowledge.json, mirrored as window.KCE_KNOWLEDGE_BASE) and
   returns the best-matching entry, or an honest "not in knowledge base"
   response. No network, no AWS, no paid API required.
   ========================================================================== */
(function (global) {
  "use strict";

  var STOPWORDS = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "do", "does", "did", "have", "has", "had", "of", "for", "to", "in", "on",
    "at", "by", "with", "from", "as", "and", "or", "but", "if", "so", "than",
    "then", "that", "this", "these", "those", "there", "here", "it", "its",
    "i", "me", "my", "we", "our", "you", "your", "he", "she", "they", "them",
    "can", "could", "would", "should", "will", "shall", "may", "might", "must",
    "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
    "please", "tell", "about", "give", "want", "need", "know", "any", "some",
    "much", "many", "more", "most", "also", "just", "get", "got"
  ]);

  var SYNONYMS = {
    course: ["course"],
    courses: ["course"],
    program: ["course"],
    programs: ["course"],
    programme: ["course"],
    programmes: ["course"],
    branch: ["course"],
    branches: ["course"],
    department: ["department"],
    departments: ["department"],
    dept: ["department"],
    admission: ["admission"],
    admissions: ["admission"],
    apply: ["admission"],
    application: ["admission"],
    enrol: ["admission"],
    enroll: ["admission"],
    enrollment: ["admission"],
    enrolment: ["admission"],
    join: ["admission"],
    fee: ["fee"],
    fees: ["fee"],
    tuition: ["fee"],
    cost: ["fee"],
    placement: ["placement"],
    placements: ["placement"],
    job: ["placement"],
    jobs: ["placement"],
    career: ["placement"],
    recruit: ["placement"],
    recruitment: ["placement"],
    hostel: ["hostel"],
    hostels: ["hostel"],
    accommodation: ["hostel"],
    room: ["hostel"],
    stay: ["hostel"],
    bus: ["transport"],
    buses: ["transport"],
    transport: ["transport"],
    commute: ["transport"],
    library: ["library"],
    books: ["library"],
    wifi: ["internet"],
    "wi-fi": ["internet"],
    internet: ["internet"],
    network: ["internet"],
    phone: ["contact"],
    contact: ["contact"],
    email: ["contact"],
    mail: ["contact"],
    call: ["contact"],
    reach: ["contact"],
    address: ["location"],
    location: ["location"],
    where: ["location"],
    scholarship: ["scholarship"],
    scholarships: ["scholarship"],
    timetable: ["exam"],
    exam: ["exam"],
    exams: ["exam"],
    examination: ["exam"],
    schedule: ["exam"],
    attendance: ["attendance"],
    sports: ["sport"],
    sport: ["sport"],
    games: ["sport"],
    club: ["club"],
    clubs: ["club"],
    activities: ["club"],
    about: ["about"],
    overview: ["about"],
    history: ["about"],
    placement_cell: ["placement"]
  };

  function normalize(text) {
    return String(text == null ? "" : text)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[^a-z0-9\s'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stem(word) {
    if (word.length <= 3) return word;
    if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
    if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
    if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }

  function tokenize(text) {
    var parts = normalize(text).split(" ").filter(Boolean);
    var out = new Set();

    parts.forEach(function (part) {
      var token = part.replace(/'/g, "");
      if (!token) return;
      var mapped = SYNONYMS[token] || [token];
      mapped.forEach(function (term) {
        var stemmed = stem(term);
        if (stemmed && !STOPWORDS.has(stemmed)) out.add(stemmed);
      });
    });

    return Array.from(out);
  }

  function buildEntryIndex(entry) {
    var haystack = [
      entry.title || "",
      entry.category || "",
      entry.question || "",
      (entry.keywords || []).join(" "),
      entry.answer || ""
    ].join(" ");

    return {
      entry: entry,
      tokens: new Set(tokenize(haystack)),
      titleTokens: new Set(tokenize((entry.title || "") + " " + (entry.question || ""))),
      keywords: (entry.keywords || []).map(normalize).filter(Boolean)
    };
  }

  function scoreEntry(item, normalizedQuery, queryTokens) {
    var entry = item.entry;
    var score = 0;
    var matchedKeywords = 0;

    item.keywords.forEach(function (keyword) {
      if (!keyword) return;
      var wordCount = keyword.split(" ").length;
      if (normalizedQuery.indexOf(keyword) !== -1) {
        score += wordCount > 1 ? 7 : 4;
        matchedKeywords += 1;
      }
    });

    var matchedTokens = 0;
    queryTokens.forEach(function (token) {
      if (item.tokens.has(token)) {
        score += 2;
        matchedTokens += 1;
      }
      if (item.titleTokens.has(token)) {
        score += 1.5;
      }
    });

    var coverage = queryTokens.length ? matchedTokens / queryTokens.length : 0;
    score += coverage * 5;

    return {
      score: score,
      coverage: coverage,
      matchedKeywords: matchedKeywords,
      matchedTokens: matchedTokens,
      entry: entry
    };
  }

  function getKnowledgeBase() {
    return Array.isArray(global.KCE_KNOWLEDGE_BASE) ? global.KCE_KNOWLEDGE_BASE : [];
  }

  function entryToReply(entry) {
    return {
      text: entry.answer,
      sources: Array.isArray(entry.sources) ? entry.sources.slice() : [],
      followups: Array.isArray(entry.followups) ? entry.followups.slice(0, 3) : [],
      matched: entry.id,
      confidence: 1,
      source: "local"
    };
  }

  function fallbackReply() {
    return {
      text:
        "I couldn't find verified information about that in the KCE knowledge base, and I won't guess.\n\n" +
        "Please check the official college website or contact the college office:\n" +
        "• Website: https://kingsengg.edu.in/\n" +
        "• Phone: +91-6380989024\n" +
        "• Email: contact@kingsengg.edu.in\n\n" +
        "You can also try rephrasing your question — for example, ask about courses, admissions, facilities, placements, or contact details.",
      sources: [
        { title: "KCE Home", url: "https://kingsengg.edu.in/" },
        { title: "Contact Us", url: "https://kingsengg.edu.in/contact.html" }
      ],
      followups: [
        "What courses does KCE offer?",
        "How do I apply for admission?",
        "How can I contact the college?"
      ],
      matched: null,
      confidence: 0,
      source: "local",
      unknown: true
    };
  }

  function retrieve(question, knowledgeBase) {
    var entries = Array.isArray(knowledgeBase) ? knowledgeBase : getKnowledgeBase();
    if (!entries.length) return null;

    var normalizedQuery = normalize(question);
    var queryTokens = tokenize(question);
    if (!queryTokens.length) return null;

    var best = null;
    entries.forEach(function (entry) {
      var item = buildEntryIndex(entry);
      var result = scoreEntry(item, normalizedQuery, queryTokens);
      if (!best || result.score > best.score) best = result;
    });

    if (!best) return null;

    /* Require both a minimum score and reasonable query coverage so that
       unrelated questions do not receive a random answer. */
    if (best.score < 4 || best.coverage < 0.2) return null;

    return best.entry;
  }

  function answer(question, knowledgeBase) {
    var entry = retrieve(question, knowledgeBase);
    if (!entry) return fallbackReply();
    return entryToReply(entry);
  }

  global.KCERetrieval = {
    version: "1.0.0",
    normalize: normalize,
    tokenize: tokenize,
    retrieve: retrieve,
    answer: answer,
    fallback: fallbackReply,
    count: function () {
      return getKnowledgeBase().length;
    },
    isReady: function () {
      return getKnowledgeBase().length > 0;
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
