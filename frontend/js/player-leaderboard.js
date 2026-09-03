// ============================================================
// Shared Players leaderboard (used by both the user matches page
// and the admin dashboard). Renders:
//   - a "filter by match" dropdown (season = all completed matches)
//   - Season Leaders: Orange Cap (top runs) + Purple Cap (top wickets)
//   - stat tabs: Fantasy Points, Runs, Wickets, Catches, Fours,
//     Sixes, Best Score, Strike Rate, Economy, Stumpings, Run Outs,
//     Most Picked, Captain Picks
// Exposes window.PlayerLeaderboard.render(container)
// ============================================================

(function () {
  const STATS = [
    { key: 'points', label: 'Fantasy Points', valueOf: p => p.total_points, fmt: v => v },
    { key: 'runs', label: 'Runs', valueOf: p => p.total_runs, fmt: v => v },
    { key: 'wickets', label: 'Wickets', valueOf: p => p.total_wickets, fmt: v => v },
    { key: 'catches', label: 'Catches', valueOf: p => p.total_catches, fmt: v => v },
    { key: 'fours', label: 'Fours', valueOf: p => p.total_fours, fmt: v => v },
    { key: 'sixes', label: 'Sixes', valueOf: p => p.total_sixes, fmt: v => v },
    { key: 'best_score', label: 'Best Score', valueOf: p => p.best_runs, fmt: v => v },
    { key: 'strike_rate', label: 'Strike Rate', valueOf: p => p.strike_rate, fmt: v => (v == null ? '—' : v.toFixed(1)) },
    { key: 'economy', label: 'Economy', valueOf: p => p.economy_rate, fmt: v => (v == null ? '—' : v.toFixed(2)), asc: true },
    { key: 'stumpings', label: 'Stumpings', valueOf: p => p.total_stumpings, fmt: v => v },
    { key: 'run_outs', label: 'Run Outs', valueOf: p => p.total_run_outs, fmt: v => v },
    { key: 'picks', label: 'Most Picked', valueOf: p => p.picks, fmt: v => v },
    { key: 'captain', label: 'Captain Picks', valueOf: p => p.captain_picks, fmt: v => v }
  ];

  const state = {
    containerEl: null,
    data: null,
    statKey: 'points',
    matchId: '',
    matchOptions: null
  };

  function esc(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function teamLogo(team) {
    if (team && team.logo_url) {
      return `<img src="${esc(team.logo_url)}" alt="${esc(team.short_code || team.name)}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;background:#fff;border:1px solid var(--border);flex-shrink:0;">`;
    }
    return `<div style="width:34px;height:34px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">${esc((team && team.short_code || '?').slice(0, 3))}</div>`;
  }

  function currentMeta() {
    return STATS.find(s => s.key === state.statKey) || STATS[0];
  }

  function rankedRows() {
    const meta = currentMeta();
    return [...state.data]
      .filter(p => (meta.valueOf(p) || 0) > 0)
      .sort((a, b) => {
        const av = meta.valueOf(a) || 0;
        const bv = meta.valueOf(b) || 0;
        return meta.asc ? av - bv : bv - av;
      })
      .map((p, i) => ({ ...p, rank: i + 1 }));
  }

  function capsData() {
    const byRuns = [...state.data].sort((a, b) => (b.total_runs || 0) - (a.total_runs || 0));
    const byWickets = [...state.data].sort((a, b) => (b.total_wickets || 0) - (a.total_wickets || 0));
    return {
      orange: byRuns[0] && byRuns[0].total_runs > 0 ? byRuns[0] : null,
      purple: byWickets[0] && byWickets[0].total_wickets > 0 ? byWickets[0] : null
    };
  }

  function capCard(p, capLabel, valueText, bgColor) {
    return `
      <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
        ${teamLogo(p.team)}
        <div style="min-width:0; flex:1;">
          <span style="display:inline-block; padding:1px 8px; border-radius:10px; color:#fff; background:${bgColor}; font-size:11px; font-weight:700; letter-spacing:.5px;">${capLabel}</span>
          <div style="font-weight:700; font-size:14px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(p.name)} <span class="match-meta" style="font-size:12px; font-weight:400;">· ${esc(p.team?.name || 'Unknown team')}</span></div>
        </div>
        <span style="font-weight:700; color:var(--primary); flex-shrink:0;">${valueText}</span>
      </div>
    `;
  }

  function renderRows() {
    const meta = currentMeta();
    const list = rankedRows();
    if (list.length === 0) {
      return `<div class="card"><p>No players with ${esc(meta.label.toLowerCase())} yet. Stats appear once matches are completed.</p></div>`;
    }
    return list.map(p => `
      <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          ${teamLogo(p.team)}
          <div style="min-width:0;">
            <div style="font-weight:700; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><span style="color:var(--muted); font-weight:600;">${p.rank}.</span> ${esc(p.name)}</div>
            <div class="match-meta" style="font-size:12px;">${esc(p.team?.name || 'Unknown team')} · ${esc(p.role)} · ${p.matches_played} match${p.matches_played === 1 ? '' : 'es'}${state.statKey !== 'points' && (p.total_points || 0) > 0 ? ` · ${p.total_points} pts` : ''}</div>
          </div>
        </div>
        <span style="font-weight:700; color:var(--primary); flex-shrink:0;">${meta.fmt(meta.valueOf(p))}</span>
      </div>
    `).join('');
  }

  function matchDropdownHtml() {
    if (!state.matchOptions || state.matchOptions.length === 0) {
      return '';
    }
    const options = [
      '<option value="">All completed matches (season stats)</option>',
      ...state.matchOptions.map(m => {
        const label = `${m.team_a?.short_code || m.team_a?.name || '?'} vs ${m.team_b?.short_code || m.team_b?.name || '?'}`;
        return `<option value="${esc(m.id)}" ${state.matchId === m.id ? 'selected' : ''}>${esc(label)}</option>`;
      })
    ];
    return `
      <label style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:8px;">
        <span class="match-meta" style="font-size:13px;">Filter by match:</span>
        <select id="plbMatchFilter" style="max-width:100%;">${options.join('')}</select>
      </label>
    `;
  }

  async function render(container) {
    state.containerEl = container;

    if (state.matchOptions === null) {
      try {
        const matches = await Api.getMatches();
        state.matchOptions = (matches || []).filter(m => m.status === 'completed');
      } catch (_) {
        state.matchOptions = [];
      }
    }

    if (state.data === null) {
      try {
        state.data = await Api.getPlayerLeaderboard(undefined, state.matchId);
      } catch (err) {
        container.innerHTML = `<div class="card"><p class="error-msg">${esc(err.message)}</p></div>`;
        return;
      }
    }

    if (state.data.length === 0) {
      container.innerHTML = '<div class="card"><p>No player stats yet. Stats appear once matches are completed.</p></div>';
      return;
    }

    const caps = capsData();
    const awardsCards = (caps.orange || caps.purple)
      ? `
        <div class="card">
          <h3>Season Leaders</h3>
          <div style="display:flex; flex-direction:column; gap:12px;">
            ${caps.orange ? capCard(caps.orange, 'ORANGE CAP', `${caps.orange.total_runs} runs`, '#E8590C') : ''}
            ${caps.purple ? capCard(caps.purple, 'PURPLE CAP', `${caps.purple.total_wickets} wickets`, '#7048E8') : ''}
          </div>
        </div>`
      : '';

    container.innerHTML = `
      <div class="card">
        <h3>Players Leaderboard</h3>
        <p class="match-meta">Players across both teams, ranked by stats accumulated across completed matches.</p>
        ${matchDropdownHtml()}
      </div>
      ${awardsCards}
      <div class="tab-nav" id="plbStatTabs">
        ${STATS.map(s => `
          <a href="#" ${state.statKey === s.key ? 'class="active"' : ''} data-stat="${s.key}">${esc(s.label)}</a>
        `).join('')}
      </div>
      <div id="plbList">${renderRows()}</div>
    `;

    const select = document.getElementById('plbMatchFilter');
    if (select) {
      select.addEventListener('change', () => {
        state.matchId = select.value;
        state.data = null;
        render(state.containerEl);
      });
    }

    document.querySelectorAll('#plbStatTabs a').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        state.statKey = tab.dataset.stat;
        render(state.containerEl);
      });
    });
  }

  window.PlayerLeaderboard = { render };
})();