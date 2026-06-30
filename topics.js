'use strict';

/*
 * The practice taxonomy: two domains, each with topics, practiced at a
 * difficulty level. A "category" is a (domain, topic, difficulty) triple,
 * e.g. math / algebra / medium.
 *
 * This mirrors the College Board SAT content domains so each PDF you upload
 * maps cleanly to one section.
 */

const TAXONOMY = {
  math: {
    label: 'Math',
    emoji: '🔢',
    topics: {
      'algebra': 'ALG',
      'advanced-math': 'ADV MATH',
      'psda': 'PS DA',
      'geometry': 'GEO TRIG',
    },
  },
  reading: {
    label: 'Reading & Writing',
    emoji: '📖',
    topics: {
      'information-ideas': 'INFO IDEAS',
      'craft-structure': 'CRAFT STRUCT',
      'expression-ideas': 'EXP IDEAS',
      'standard-conventions': 'PUNCT GRMR',
    },
  },
};

// Full, human-readable topic names (the abbreviations above are the compact
// labels used in tables/charts; these are shown where there's room, e.g. Home).
const TOPIC_FULL = {
  'algebra': 'Algebra',
  'advanced-math': 'Advanced Math',
  'psda': 'Problem-Solving and Data Analysis',
  'geometry': 'Geometry and Trigonometry',
  'information-ideas': 'Information and Ideas',
  'craft-structure': 'Craft and Structure',
  'expression-ideas': 'Expression of Ideas',
  'standard-conventions': 'Standard English Conventions',
};

const DIFFICULTIES = ['medium', 'hard'];

const DIFFICULTY_LABELS = { medium: 'Medium', hard: 'Hard' };

// topic -> domain
function domainOfTopic(topic) {
  for (const [domain, d] of Object.entries(TAXONOMY)) {
    if (d.topics[topic]) return domain;
  }
  return null;
}

function topicLabel(topic) {
  for (const d of Object.values(TAXONOMY)) {
    if (d.topics[topic]) return d.topics[topic];
  }
  return topic;
}

function topicFullName(topic) {
  return TOPIC_FULL[topic] || topicLabel(topic);
}

function isValidTopic(topic) {
  return !!domainOfTopic(topic);
}

function isValidDifficulty(diff) {
  return DIFFICULTIES.includes(diff);
}

// Flat list of every category in display order.
function allCategories() {
  const out = [];
  for (const [domain, d] of Object.entries(TAXONOMY)) {
    for (const topic of Object.keys(d.topics)) {
      for (const difficulty of DIFFICULTIES) {
        out.push({ domain, topic, difficulty });
      }
    }
  }
  return out;
}

module.exports = {
  TAXONOMY,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  domainOfTopic,
  topicLabel,
  topicFullName,
  isValidTopic,
  isValidDifficulty,
  allCategories,
};
