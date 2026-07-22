// Parses text extracted from a CricHeroes-style "Summary Scorecard" PDF
// into per-player aggregated stats, including the extra fields needed for
// Dream11-style scoring (fours, sixes, balls faced, overs bowled, maidens,
// runs conceded, bowled/LBW wickets, dismissed/not-out). Designed to be
// tolerant: if a line doesn't match expected patterns, it's skipped rather
// than crashing - the resulting CSV is always meant to be reviewed/edited
// by the admin before being used as the official stats source.

function stripHandednessAndTags(rawName) {
  // Removes trailing "(RHB)"/"(LHB)" and inline tags like "(c)", "(wk)"
  // to get a cleaner name for matching purposes. Keeps the original
  // raw name separately for display.
  return rawName
    .replace(/\((?:RHB|LHB)\)/gi, '')
    .replace(/\(\s*c\s*\)/gi, '')
    .replace(/\(\s*wk\s*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getOrCreate(stats, name) {
  const key = name.toLowerCase();
  if (!stats.has(key)) {
    stats.set(key, {
      name,
      runs: 0, balls_faced: 0, fours: 0, sixes: 0, is_out: false,
      wickets: 0, bowled_lbw_wickets: 0, maidens: 0, overs_bowled: 0, runs_conceded: 0,
      catches: 0, stumpings: 0, run_outs: 0
    });
  }
  return stats.get(key);
}

function creditFielding(stats, rawName, field) {
  if (!rawName) return;
  const name = stripHandednessAndTags(rawName.trim());
  if (!name) return;
  const entry = getOrCreate(stats, name);
  entry[field] += 1;
}

function parseBatsmanLine(line) {
  // This export format inconsistently mixes two styles for the same table:
  // sometimes "<No> <Name (Type)>" are joined in one tab field, sometimes
  // "<No>" and "<Name (Type)>" are separate tab fields. Handle both.
  const parts = line.split('\t').map(s => s.trim()).filter(s => s.length > 0);
  if (parts.length < 3) return null;

  const noOnly = parts[0].match(/^(\d+)$/);
  const noPlusName = parts[0].match(/^(\d+)\s+(.+)$/);

  let nameRaw, restParts;
  if (noOnly) {
    // Case A: No and Name are separate tab fields
    nameRaw = parts[1];
    restParts = parts.slice(2);
  } else if (noPlusName) {
    // Case B: No and Name are joined in the same tab field
    nameRaw = noPlusName[2];
    restParts = parts.slice(1);
  } else {
    return null;
  }

  if (!/\((?:RHB|LHB)\)/i.test(nameRaw)) return null; // not a batsman row

  const rest = restParts.join(' ');
  // Trailing 6 numbers: R B M 4s 6s SR (SR is decimal)
  const m = rest.match(/^(.*?)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+([\d.]+)\s*$/);
  if (!m) return null;

  const status = m[1].trim();

  return {
    nameRaw,
    status,
    runs: parseInt(m[2], 10),
    balls_faced: parseInt(m[3], 10),
    fours: parseInt(m[5], 10),
    sixes: parseInt(m[6], 10),
    is_out: !/^not\s*out/i.test(status) && !/retired\s*not\s*out/i.test(status)
  };
}

function parseBowlerLine(line) {
  // Expect: <No>\t<Bowler Name>\t...10 numeric columns: O M R W 0s 4s 6s WD NB Eco
  const parts = line.split('\t').map(s => s.trim()).filter(s => s.length > 0);
  if (parts.length < 3) return null;
  if (!/^\d+$/.test(parts[0])) return null;

  const nameRaw = parts[1];
  const rest = parts.slice(2).join(' ');
  const numbers = rest.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 10) return null;

  // O M R W 0s 4s 6s WD NB Eco
  const overs_bowled = parseFloat(numbers[0]);
  const maidens = parseInt(numbers[1], 10);
  const runs_conceded = parseInt(numbers[2], 10);
  const wickets = parseInt(numbers[3], 10);
  if (isNaN(wickets)) return null;

  return { nameRaw, overs_bowled, maidens, runs_conceded, wickets };
}

function creditBowledLbw(stats, rawBowlerName) {
  if (!rawBowlerName) return;
  const name = stripHandednessAndTags(rawBowlerName.trim());
  if (!name) return;
  const entry = getOrCreate(stats, name);
  entry.bowled_lbw_wickets += 1;
}

function creditDismissal(stats, statusText) {
  const text = statusText.trim();

  // c&b <bowler> - the bowler caught their own delivery
  let m = text.match(/^c\s*&\s*b\s+(.+)$/i);
  if (m) {
    creditFielding(stats, m[1], 'catches');
    return;
  }

  // c <fielder> b <bowler>
  m = text.match(/^c\s+(.+?)\s+b\s+(.+)$/i);
  if (m) {
    creditFielding(stats, m[1], 'catches');
    return;
  }

  // st <keeper> b <bowler>
  m = text.match(/^st\s+(.+?)\s+b\s+(.+)$/i);
  if (m) {
    creditFielding(stats, m[1], 'stumpings');
    return;
  }

  // run out (<fielder>) - may list multiple names separated by /
  m = text.match(/run\s*out\s*\(([^)]+)\)/i);
  if (m) {
    m[1].split('/').forEach(n => creditFielding(stats, n, 'run_outs'));
    return;
  }

  // lbw b <bowler> - counts toward the bowler's bowled/LBW bonus
  m = text.match(/^lbw\s+b\s+(.+)$/i);
  if (m) {
    creditBowledLbw(stats, m[1]);
    return;
  }

  // b <bowler> (bowled) - counts toward the bowler's bowled/LBW bonus
  m = text.match(/^b\s+(.+)$/i);
  if (m) {
    creditBowledLbw(stats, m[1]);
    return;
  }

  // "not out", "retired", etc: no credit needed either way.
}

export function parseScorecardText(text) {
  const stats = new Map(); // key: lowercased clean name -> aggregated row
  const lines = text.split('\n');

  for (const line of lines) {
    const bat = parseBatsmanLine(line);
    if (bat) {
      const cleanName = stripHandednessAndTags(bat.nameRaw);
      if (cleanName) {
        const entry = getOrCreate(stats, cleanName);
        entry.runs += bat.runs;
        entry.balls_faced += bat.balls_faced;
        entry.fours += bat.fours;
        entry.sixes += bat.sixes;
        if (bat.is_out) entry.is_out = true;
      }
      creditDismissal(stats, bat.status);
      continue;
    }

    const bowl = parseBowlerLine(line);
    if (bowl) {
      const cleanName = stripHandednessAndTags(bowl.nameRaw);
      if (cleanName) {
        const entry = getOrCreate(stats, cleanName);
        entry.wickets += bowl.wickets;
        entry.maidens += bowl.maidens;
        entry.runs_conceded += bowl.runs_conceded;
        // Overs bowled uses cricket notation (whole overs + balls, not
        // decimal) - simple addition of two such values isn't quite right
        // if a player somehow appears in two spells, but that's rare in
        // this single-innings-per-team export format, so plain overwrite
        // (not addition) is safer here to avoid ball-carry errors.
        entry.overs_bowled = bowl.overs_bowled;
      }
    }
  }

  return Array.from(stats.values());
}

// Normalizes a name for fuzzy matching against the internal player roster -
// strips parenthetical tags, punctuation, and extra whitespace, lowercases.
// Real-world scorecards often spell/format names slightly differently than
// however they were entered in the app, so exact matches aren't guaranteed;
// this is a best-effort helper, not a source of truth.
export function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
