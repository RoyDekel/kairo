/**
 * Rivalry and signature-event knowledge, shared by the event merger and the travel
 * occasion detector.
 *
 * Lives in shared/ because two consumers need the same table: eventMerge.js uses it to
 * recognise that "El Clásico" and "Barcelona vs Real Madrid" are the same fixture, and
 * travelOccasion.js uses it to recognise that being in town for one is rare.
 */

/**
 * Fixture nicknames that carry no team names, mapped to the pair they describe.
 *
 * Every entry here is also treated as a marquee occasion — these are the matches people
 * plan trips around, which is exactly what makes them worth flagging.
 */
export const FIXTURE_ALIASES = {
  'el clasico': ['barcelona', 'real madrid'],
  'el clásico': ['barcelona', 'real madrid'],
  'der klassiker': ['bayern munich', 'borussia dortmund'],
  'north london derby': ['arsenal', 'tottenham'],
  'manchester derby': ['manchester city', 'manchester united'],
  'merseyside derby': ['liverpool', 'everton'],
  'derby della madonnina': ['inter', 'milan'],
  'milan derby': ['inter', 'milan'],
  'derby d italia': ['juventus', 'inter'],
  'old firm': ['celtic', 'rangers'],
  'de klassieker': ['ajax', 'feyenoord'],
  'o classico': ['benfica', 'porto'],
  'superclasico': ['boca juniors', 'river plate'],
  'süperklasik': ['galatasaray', 'fenerbahce'],
  'le classique': ['paris saint germain', 'marseille']
};

/**
 * Team pairs whose meeting is a marquee occasion regardless of what the event is called.
 *
 * Derived from FIXTURE_ALIASES so the two can't drift: if a rivalry is worth aliasing, it
 * is worth flagging.
 */
export const MARQUEE_PAIRS = Object.values(FIXTURE_ALIASES).map((pair) => [...pair].sort());

/**
 * Signature events people travel specifically to attend.
 *
 * IMPORTANT: this table does NOT assert that anything is happening. It only recognises an
 * event a provider actually returned as being one of the significant ones. Inferring
 * "you're visiting during Oktoberfest" from a date range would be a guess presented as a
 * fact, and the whole point of the occasion badge is that it can be trusted.
 */
export const SIGNATURE_EVENTS = [
  'oktoberfest',
  'primavera sound',
  'sonar',
  'la tomatina',
  'running of the bulls',
  'san fermin',
  'carnival',
  'carnaval',
  'wimbledon',
  'roland garros',
  'us open',
  'tour de france',
  'glastonbury',
  'coachella',
  'rock in rio',
  'mardi gras',
  'st patricks day',
  'la mercè',
  'la merce',
  'kings day',
  'koningsdag',
  'hogmanay',
  'edinburgh fringe',
  'fringe festival',
  'notting hill carnival'
];

/** Titles that indicate a decisive or one-off occasion rather than a routine date. */
export const DECIDER_KEYWORDS = [
  'final',
  'semi final',
  'semifinal',
  'grand prix',
  'championship',
  'playoff',
  'play off',
  'world cup',
  'champions league',
  'derby',
  'clasico',
  'clásico',
  'cup final',
  'title decider',
  'olympic'
];
