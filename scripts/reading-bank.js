'use strict';

/*
 * Authored medium-difficulty Reading & Writing starter questions.
 * Each item: { passage?, prompt, choices: [4 strings], correct: 'A'|'B'|'C'|'D', explanation }
 * Replace/expand these by importing your own PDF (see scripts/import-pdf.js).
 */

module.exports = [
  // ---- Grammar: subject-verb agreement ----
  {
    prompt: 'Which choice completes the sentence so that it conforms to the conventions of Standard English?\n\n"The collection of rare coins ____ displayed in the museum\'s east wing."',
    choices: ['are', 'is', 'were', 'have been'],
    correct: 'B',
    explanation: 'The subject is "collection" (singular), not "coins." A singular subject takes the singular verb "is."',
  },
  {
    prompt: 'Which choice conforms to the conventions of Standard English?\n\n"Neither the teacher nor the students ____ aware of the schedule change."',
    choices: ['was', 'were', 'is', 'has been'],
    correct: 'B',
    explanation: 'With "neither/nor," the verb agrees with the nearer subject, "students" (plural), so "were" is correct.',
  },
  {
    prompt: 'Which choice conforms to the conventions of Standard English?\n\n"Each of the runners ____ given a numbered bib before the race."',
    choices: ['were', 'are', 'was', 'have been'],
    correct: 'C',
    explanation: '"Each" is singular and takes a singular verb, so "was" is correct.',
  },
  // ---- Punctuation: comma / semicolon / colon ----
  {
    prompt: 'Which choice correctly punctuates the sentence?\n\n"Maria packed three items for the trip ____ a map, a compass, and a water bottle."',
    choices: [', that is', ': a map', ': ', '— '],
    correct: 'C',
    explanation: 'A colon introduces a list that follows a complete clause. "Maria packed three items for the trip:" is a complete clause, so the colon is correct.',
  },
  {
    prompt: 'Which choice correctly joins the two independent clauses?\n\n"The experiment failed twice ____ the team refused to give up."',
    choices: [', but', ' but', '; but', ', and but'],
    correct: 'A',
    explanation: 'Two independent clauses joined by the coordinating conjunction "but" require a comma before it: ", but."',
  },
  {
    prompt: 'Which choice correctly punctuates the sentence?\n\n"My favorite author ____ whose novels I reread every summer ____ will speak at the library."',
    choices: [', / ,', ': / :', '( / )', '; / ;'],
    correct: 'A',
    explanation: 'The phrase "whose novels I reread every summer" is a nonessential clause and should be set off with a pair of commas.',
  },
  {
    prompt: 'Which choice correctly completes the sentence?\n\n"The storm knocked out power across the city ____ thousands of homes went dark within minutes."',
    choices: [', ', '; ', ' and so, ', ': however '],
    correct: 'B',
    explanation: 'Both parts are independent clauses with no conjunction, so a semicolon correctly links them.',
  },
  // ---- Transitions ----
  {
    prompt: 'Which transition best fits the blank?\n\n"The new policy reduced waiting times. ____, several patients reported feeling rushed during appointments."',
    choices: ['Therefore', 'However', 'Likewise', 'For example'],
    correct: 'B',
    explanation: 'The second sentence presents a contrast (a downside) to the improvement, so the contrasting transition "However" fits.',
  },
  {
    prompt: 'Which transition best fits the blank?\n\n"Solar panels are now cheaper to manufacture than ever. ____, installation rates have risen sharply over the past decade."',
    choices: ['Nevertheless', 'In contrast', 'As a result', 'Otherwise'],
    correct: 'C',
    explanation: 'Rising installation rates are a consequence of cheaper panels, so the cause-and-effect transition "As a result" fits.',
  },
  {
    prompt: 'Which transition best fits the blank?\n\n"The first draft was disorganized and full of errors. ____, the editor decided to rewrite it entirely."',
    choices: ['Consequently', 'For instance', 'In addition', 'Similarly'],
    correct: 'A',
    explanation: 'The editor\'s decision results from the draft\'s problems, so "Consequently" signals the correct cause-effect relationship.',
  },
  {
    prompt: 'Which transition best fits the blank?\n\n"The museum offers free admission on weekdays. ____, it hosts guided tours twice each afternoon."',
    choices: ['However', 'In addition', 'Therefore', 'Instead'],
    correct: 'B',
    explanation: 'The sentence adds another offering, so the additive transition "In addition" fits.',
  },
  // ---- Pronoun / modifier ----
  {
    prompt: 'Which choice conforms to the conventions of Standard English?\n\n"When a student studies consistently, ____ tends to perform better on exams."',
    choices: ['they', 'he or she', 'them', 'you'],
    correct: 'B',
    explanation: 'The singular antecedent "a student" requires a singular pronoun; "he or she" agrees in number.',
  },
  {
    prompt: 'Which choice corrects the misplaced modifier?\n\n"Walking through the forest, ____."',
    choices: [
      'the tall trees amazed us',
      'we were amazed by the tall trees',
      'the trees were amazing to walk through',
      'amazement filled the air',
    ],
    correct: 'B',
    explanation: 'The opening phrase "Walking through the forest" must describe the people doing the walking, "we." Only choice B places "we" right after the phrase.',
  },
  {
    prompt: 'Which choice conforms to the conventions of Standard English?\n\n"The committee announced ____ decision after a long debate."',
    choices: ['their', 'they\'re', 'its', 'it\'s'],
    correct: 'C',
    explanation: '"Committee" is a singular collective noun acting as one unit, so the singular possessive "its" is correct.',
  },
  // ---- Verb tense / form ----
  {
    prompt: 'Which choice conforms to the conventions of Standard English?\n\n"By the time the guests arrived, the chef ____ the meal."',
    choices: ['has prepared', 'had prepared', 'prepares', 'will prepare'],
    correct: 'B',
    explanation: 'The past perfect "had prepared" shows an action completed before another past action (the guests arriving).',
  },
  {
    prompt: 'Which choice conforms to the conventions of Standard English?\n\n"If she ____ earlier, she would have caught the train."',
    choices: ['leaves', 'left', 'had left', 'has left'],
    correct: 'C',
    explanation: 'A past unreal conditional uses "had left" in the if-clause to match "would have caught."',
  },
  // ---- Concision / word choice ----
  {
    prompt: 'Which choice best expresses the idea concisely?',
    choices: [
      'Due to the fact that it was raining, the game was postponed.',
      'Because it was raining, the game was postponed.',
      'On account of the rainy weather conditions, the game was postponed.',
      'The game, because of rain that was falling, was postponed.',
    ],
    correct: 'B',
    explanation: '"Because it was raining" conveys the cause most concisely without redundant phrasing.',
  },
  {
    prompt: 'Which choice best maintains a formal tone appropriate for an academic essay?',
    choices: [
      'The results were totally awesome and blew everyone away.',
      'The results were super surprising to the researchers.',
      'The results were unexpected and prompted further study.',
      'The results kind of shocked the whole team.',
    ],
    correct: 'C',
    explanation: 'Choice C uses precise, formal language suited to academic writing; the others are too casual.',
  },
  // ---- Vocabulary in context ----
  {
    passage: 'Although the river appeared calm on the surface, the current beneath was deceptively powerful, pulling debris swiftly downstream.',
    prompt: 'As used in the sentence, "deceptively" most nearly means',
    choices: ['honestly', 'misleadingly', 'obviously', 'gently'],
    correct: 'B',
    explanation: 'The surface looked calm but the current was strong, so appearances were misleading. "Deceptively" means in a misleading way.',
  },
  {
    passage: 'The scientist was meticulous in her work, recording every measurement twice and double-checking each calculation.',
    prompt: 'As used in the sentence, "meticulous" most nearly means',
    choices: ['careless', 'careful', 'hurried', 'reluctant'],
    correct: 'B',
    explanation: 'Recording measurements twice and double-checking shows great care, so "meticulous" means careful and precise.',
  },
  {
    passage: 'Critics praised the novel for its candid portrayal of family conflict, noting that the author held nothing back.',
    prompt: 'As used in the sentence, "candid" most nearly means',
    choices: ['dishonest', 'frank', 'cautious', 'cheerful'],
    correct: 'B',
    explanation: 'The author "held nothing back," indicating openness and honesty, so "candid" means frank.',
  },
  {
    passage: 'The negotiations reached an impasse when neither side was willing to compromise on the central issue.',
    prompt: 'As used in the sentence, "impasse" most nearly means',
    choices: ['agreement', 'deadlock', 'celebration', 'beginning'],
    correct: 'B',
    explanation: 'Neither side would compromise, so the talks were stuck. An "impasse" is a deadlock.',
  },
  {
    passage: 'Her arguments were so cogent that even her opponents conceded the strength of her reasoning.',
    prompt: 'As used in the sentence, "cogent" most nearly means',
    choices: ['confusing', 'convincing', 'lengthy', 'emotional'],
    correct: 'B',
    explanation: 'Opponents conceded the strength of her reasoning, so her arguments were convincing. "Cogent" means convincing.',
  },
  // ---- Main idea / purpose ----
  {
    passage: 'Honeybees communicate the location of food through a "waggle dance." The angle of the dance relative to the sun indicates direction, while the duration of the waggle signals distance. Researchers have found that bees adjust the dance as the sun moves across the sky, demonstrating a remarkable internal sense of time.',
    prompt: 'Which choice best states the main idea of the passage?',
    choices: [
      'Honeybees prefer food sources that are close to the hive.',
      'Honeybees use a precise dance to convey the direction and distance of food.',
      'The sun is the most important factor in a bee\'s daily life.',
      'Researchers disagree about how bees find food.',
    ],
    correct: 'B',
    explanation: 'The passage explains how the waggle dance encodes both direction (angle) and distance (duration), which choice B captures.',
  },
  {
    passage: 'Early photographers faced a major obstacle: exposure times could last several minutes. Subjects had to remain perfectly still, which is why people in nineteenth-century portraits rarely smile—holding a grin for minutes was nearly impossible.',
    prompt: 'The main purpose of the passage is to',
    choices: [
      'argue that early photographs are more valuable than modern ones',
      'explain why subjects in early photographs appear serious',
      'describe the chemistry of early photographic film',
      'compare photography to portrait painting',
    ],
    correct: 'B',
    explanation: 'The passage connects long exposure times to the lack of smiling, explaining why early subjects look serious.',
  },
  {
    passage: 'Urban gardens do more than provide fresh produce. They cool neighborhoods by shading pavement, absorb rainwater that would otherwise flood streets, and offer habitat for pollinators. For many city residents, they also create rare spaces for community gathering.',
    prompt: 'Which choice best describes the function of the passage?',
    choices: [
      'It lists several benefits of urban gardens beyond growing food.',
      'It argues that cities should ban concrete pavement.',
      'It explains how to start a garden in a small space.',
      'It compares urban gardens with rural farms.',
    ],
    correct: 'A',
    explanation: 'The passage enumerates multiple benefits (cooling, drainage, habitat, community), so choice A best describes its function.',
  },
  // ---- Inference ----
  {
    passage: 'The café was usually bustling by eight in the morning, but today the chairs remained stacked on the tables and the lights stayed off well past nine.',
    prompt: 'Which choice is best supported by the passage?',
    choices: [
      'The café had become more popular than ever.',
      'The café did not open at its usual time.',
      'The café had permanently closed.',
      'The café served breakfast only on weekends.',
    ],
    correct: 'B',
    explanation: 'Stacked chairs and lights off past the usual busy hour suggest the café had not opened on time. The text does not support permanent closure.',
  },
  {
    passage: 'Despite receiving the highest score on the entrance exam, Daniel hesitated before accepting the scholarship, asking the committee for a week to consider his options.',
    prompt: 'Which choice is best supported by the passage?',
    choices: [
      'Daniel was uncertain about whether to accept the scholarship.',
      'Daniel had failed the entrance exam.',
      'Daniel had already enrolled in another school.',
      'Daniel was not offered the scholarship.',
    ],
    correct: 'A',
    explanation: 'Hesitating and asking for time to consider his options indicates uncertainty, which choice A states.',
  },
  // ---- Command of evidence ----
  {
    passage: 'A study tracked two groups of students over a semester. The group that took handwritten notes scored higher on conceptual questions than the group that typed notes, even though typists recorded more words overall.',
    prompt: 'Which finding, if true, would most strongly support the idea that handwriting aids understanding?',
    choices: [
      'Typists finished their notes faster than handwriters.',
      'Handwriters rephrased ideas in their own words more often than typists.',
      'Both groups enjoyed the lectures equally.',
      'Typists used laptops with larger screens.',
    ],
    correct: 'B',
    explanation: 'Rephrasing ideas in one\'s own words reflects deeper processing, which would explain why handwriters understood concepts better.',
  },
  {
    passage: 'Proponents claim that a four-day workweek increases productivity. They point to a company trial in which weekly output stayed the same even though employees worked one fewer day.',
    prompt: 'Which detail from the passage best supports the proponents\' claim?',
    choices: [
      'Employees worked one fewer day per week.',
      'Weekly output stayed the same despite fewer working hours.',
      'The trial was conducted at a single company.',
      'The workweek was reduced to four days.',
    ],
    correct: 'B',
    explanation: 'Maintaining the same output with fewer hours is the evidence that productivity per hour rose, supporting the claim.',
  },
  // ---- More grammar variety ----
  {
    prompt: 'Which choice conforms to the conventions of Standard English?\n\n"The hikers, exhausted but proud, ____ the summit just before sunset."',
    choices: ['reaches', 'reaching', 'reached', 'has reached'],
    correct: 'C',
    explanation: 'The plural subject "hikers" needs the plain past-tense verb "reached" to complete the sentence.',
  },
  {
    prompt: 'Which choice conforms to the conventions of Standard English?\n\n"The data ____ that temperatures have risen steadily since 1950."',
    choices: ['suggests', 'suggest', 'suggesting', 'to suggest'],
    correct: 'B',
    explanation: 'In formal usage "data" is treated as plural, taking the plural verb "suggest."',
  },
  {
    prompt: 'Which choice correctly completes the sentence?\n\n"The library extended ____ hours during final exams."',
    choices: ['it\'s', 'its', 'its\'', 'their'],
    correct: 'B',
    explanation: '"Its" is the singular possessive pronoun; "it\'s" means "it is," which would be incorrect here.',
  },
  {
    prompt: 'Which choice correctly completes the sentence?\n\n"There are fewer ____ in the recipe than I expected."',
    choices: ['ingredients', 'ingredient', 'amounts', 'quantity'],
    correct: 'A',
    explanation: '"Fewer" is used with countable plural nouns, so the plural "ingredients" is correct.',
  },
  {
    prompt: 'Which choice conforms to the conventions of Standard English?\n\n"Between you and ____, the surprise party is next Friday."',
    choices: ['I', 'me', 'myself', 'mine'],
    correct: 'B',
    explanation: 'After the preposition "between," the objective pronoun "me" is required.',
  },
  {
    prompt: 'Which choice correctly punctuates the sentence?\n\n"After months of training ____ the athlete finally qualified for the national team."',
    choices: [', ', '; ', ': ', ' — and'],
    correct: 'A',
    explanation: 'An introductory dependent phrase ("After months of training") should be followed by a comma.',
  },
  {
    prompt: 'Which choice best combines the two sentences?\n\n"The lecture was long. It held the audience\'s attention throughout."',
    choices: [
      'The lecture was long, and it held the audience\'s attention throughout.',
      'Although the lecture was long, it held the audience\'s attention throughout.',
      'The lecture was long it held the audience\'s attention throughout.',
      'The lecture was long, it held the audience\'s attention throughout.',
    ],
    correct: 'B',
    explanation: 'The contrast between "long" and holding attention is best shown with "Although," which signals the concession clearly.',
  },
  {
    prompt: 'Which choice maintains parallel structure?\n\n"The coach told the team to practice daily, to eat well, and ____."',
    choices: ['getting enough sleep', 'they should sleep enough', 'to get enough sleep', 'enough sleep is important'],
    correct: 'C',
    explanation: 'The list uses "to practice," "to eat," so the third item must follow the same infinitive form: "to get enough sleep."',
  },
  {
    prompt: 'Which choice conforms to the conventions of Standard English?\n\n"Of the two routes, the coastal road is ____."',
    choices: ['the most scenic', 'more scenic', 'most scenic', 'scenicest'],
    correct: 'B',
    explanation: 'When comparing exactly two things, use the comparative "more scenic," not the superlative.',
  },
  {
    passage: 'The ancient aqueducts of Rome were engineering marvels, transporting water across great distances using only a gentle, carefully calculated downward slope and the force of gravity.',
    prompt: 'As used in the passage, "marvels" most nearly means',
    choices: ['failures', 'wonders', 'ruins', 'mysteries'],
    correct: 'B',
    explanation: 'The aqueducts are praised for their impressive engineering, so "marvels" means wonders or impressive achievements.',
  },
  {
    passage: 'Volunteers spent the weekend restoring the wetland, removing invasive plants and replanting native grasses to revive the local ecosystem.',
    prompt: 'Which choice best states the purpose of the volunteers\' work?',
    choices: [
      'to build a new park for visitors',
      'to restore the health of a natural habitat',
      'to study invasive plant species',
      'to create farmland from the wetland',
    ],
    correct: 'B',
    explanation: 'Removing invasive plants and replanting native grasses to "revive the local ecosystem" shows the goal was restoring the habitat.',
  },
  {
    passage: 'At first the apprentice resented the tedious task of sharpening tools, but over time she realized that a keen blade made every other job easier.',
    prompt: 'Which choice is best supported by the passage?',
    choices: [
      'The apprentice never learned to sharpen tools.',
      'The apprentice came to appreciate a task she initially disliked.',
      'The apprentice preferred dull tools.',
      'The apprentice quit her job.',
    ],
    correct: 'B',
    explanation: 'She resented the task at first but later recognized its value, so she came to appreciate it.',
  },
  {
    prompt: 'Which transition best fits the blank?\n\n"The bridge was scheduled to open in May. ____, construction delays pushed the opening to September."',
    choices: ['Similarly', 'However', 'Therefore', 'For example'],
    correct: 'B',
    explanation: 'The actual opening contradicts the schedule, so the contrast transition "However" is correct.',
  },
  {
    prompt: 'Which choice conforms to the conventions of Standard English?\n\n"The teacher asked the students to turn in ____ essays by Friday."',
    choices: ['their', 'there', 'they\'re', 'theirs'],
    correct: 'A',
    explanation: '"Their" is the possessive pronoun showing the essays belong to the students.',
  },
  {
    passage: 'The documentary did not shy away from controversy; it presented opposing viewpoints side by side and let viewers weigh the evidence themselves.',
    prompt: 'The passage suggests that the documentary was',
    choices: ['one-sided', 'balanced', 'humorous', 'poorly made'],
    correct: 'B',
    explanation: 'Presenting opposing viewpoints and letting viewers weigh evidence indicates a balanced approach.',
  },
];
