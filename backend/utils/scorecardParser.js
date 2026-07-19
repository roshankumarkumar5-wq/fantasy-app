// Parses text extracted from a CricHeroes-style "Summary Scorecard" PDF
// into per-player aggregated stats. Designed to be tolerant: if a line
// doesn't match expected patterns, it's skipped rather than crashing -
// the resulting CSV is always meant to be reviewed/edited by the admin
// before being used as the official stats source.

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
    stats.set(key, { name, runs: 0, wickets: 0, catches: 0, stumpings: 0, run_outs: 0 });
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

  return {
    nameRaw,
    status: m[1].trim(),
    runs: parseInt(m[2], 10)
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

  // O M R W 0s 4s 6s WD NB Eco - we need R (index 2) and W (index 3)
  const wickets = parseInt(numbers[3], 10);
  if (isNaN(wickets)) return null;

  return { nameRaw, wickets };
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

  // "b <bowler>" (bowled), "lbw b <bowler>", "not out", "retired", etc:
  // no fielding credit needed.
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
