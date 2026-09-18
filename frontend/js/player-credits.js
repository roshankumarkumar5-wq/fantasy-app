// ============================================================
// Player Stats & Credits panel (admin Settings tab).
// Shows every player's performance across completed matches and their
// current credit value, with a computer-generated suggested credit
// (produced server-side by backend/utils/creditSuggestion.js). The admin
// can:
//   - edit any player's credit and Save it
//   - pull the suggested value into the input ("Suggestion") and save
//   - apply every visible player's suggestion at once
// Exposes window.PlayerCredits.render(container)
// ============================================================

(function () {
  const state = {
    container: null,
    players: [],
    teams: [],
    selectedTeamId: 'all',
    meta: null
  };

  function esc(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function minMax() {
    return {
      min: state.meta?.min ?? 4,
      max: state.meta?.max ?? 12
    };
  }

  function teamLabel(t) {
    return t ? (t.short_code || t.name || '?') : '?';
  }

  function visiblePlayers() {
    if (state.selectedTeamId === 'all') return state.players;
    return state.players.filter(p => (p.team && p.team.id) === state.selectedTeamId);
  }

  function playerCountByTeam(teamId) {
    return state.players.filter(p => (p.team && p.team.id) === teamId).length;
  }

  function tabsHtml() {
    const total = state.players.length;
    const allTab = `<button type="button" class="${state.selectedTeamId === 'all' ? 'active' : ''}" data-team-id="all">All Teams (${total})</button>`;
    const teamTabs = state.teams.map(t => {
      const count = playerCountByTeam(t.id);
      return `<button type="button" class="${state.selectedTeamId === t.id ? 'active' : ''}" data-team-id="${esc(t.id)}">${esc(t.short_code || t.name)} (${count})</button>`;
    });
    return allTab + teamTabs.join('');
  }

  function breakdownTitle(p) {
    const b = p.credit_breakdown || {};
    const base = b.base ?? 0;
    const pts = b.points_adjustment ?? 0;
    const role = b.role_adjustment ?? 0;
    const cons = b.consistency_bonus ?? 0;
    return `Base ${base} + performance ${pts > 0 ? '+' : ''}${pts} + role ${role > 0 ? '+' : ''}${role} + consistency ${cons > 0 ? '+' : ''}${cons} = ${b.total ?? p.suggested_credit}`;
  }

  function rowsHtml() {
    const list = visiblePlayers();
    if (list.length === 0) {
      return '<tr><td colspan="10" style="text-align:center; padding:16px; color:var(--muted);">No players in this view. Add players on the Teams &amp; Players page first.</td></tr>';
    }
    return list.map(p => `
      <tr data-player-id="${esc(p.player_id)}">
        <td>
          <strong>${esc(p.name)}</strong>
          <div class="match-meta" style="font-size:11px;">${esc(teamLabel(p.team))}</div>
        </td>
        <td>${esc(p.role)}</td>
        <td>${p.matches_played}</td>
        <td>${p.total_points}</td>
        <td>${p.avg_points}</td>
        <td>${p.total_runs}</td>
        <td>${p.total_wickets}</td>
        <td>${p.role === 'batsman' || p.role === 'all-rounder' || p.role === 'keeper' ? (p.strike_rate == null ? '—' : p.strike_rate.toFixed(1)) : '—'}</td>
        <td>${p.role === 'bowler' || p.role === 'all-rounder' ? (p.economy_rate == null ? '—' : p.economy_rate.toFixed(2)) : '—'}</td>
        <td>
          <input type="number" step="0.5" min="${minMax().min}" max="${minMax().max}" class="pc-credit-input" data-player-id="${esc(p.player_id)}" value="${Number(p.credit_value)}">
        </td>
        <td>
          <span title="${esc(breakdownTitle(p))}" style="font-weight:700; color:var(--primary); cursor:help;">${p.suggested_credit}</span>
        </td>
        <td style="white-space:nowrap;">
          <button class="btn secondary action-btn-inline pc-sug" data-player-id="${esc(p.player_id)}">Use sug.</button>
          <button class="btn action-btn-inline pc-save" data-player-id="${esc(p.player_id)}">Save</button>
        </td>
      </tr>
    `).join('');
  }

  function msg(text, ok) {
    const el = document.getElementById('pcMsg');
    if (!el) return;
    el.innerHTML = `<p class="${ok ? 'success-msg' : 'error-msg'}" style="margin-top:10px;">${esc(text)}</p>`;
  }

  async function reload(afterMsg) {
    try {
      const data = await Api.getAdminPlayersStats();
      state.players = data.players || [];
      state.meta = data.credit_meta || state.meta;
      renderPanel();
      if (afterMsg) msg(afterMsg.text, afterMsg.ok);
    } catch (err) {
      state.container.innerHTML = `<div class="card"><p class="error-msg">${esc(err.message)}</p></div>`;
    }
  }

  function renderPanel() {
    const { min, max } = minMax();
    state.container.innerHTML = `
      <div class="card">
        <h3>Player Stats &amp; Credits</h3>
        <p class="match-meta">Stats are accumulated across all completed matches. The suggested credit is derived from each player's role and performance (avg fantasy points per match, plus rate-based fine tuning) — hover a suggestion to see its breakdown. Click <em>Use sug.</em> to copy it into the input, then <em>Save</em>. You can also apply suggestions to a whole team at once.</p>
        <div class="tab-nav" id="pcTeamTabs">${tabsHtml()}</div>
        <button class="btn secondary action-btn-inline" id="pcApplyAll" style="margin:4px 0 10px;">Apply suggested credits to all shown players</button>
        <div class="pc-wrap">
          <table class="pc-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Role</th>
                <th>M</th>
                <th>Pts</th>
                <th>Avg</th>
                <th>Runs</th>
                <th>Wkts</th>
                <th>SR</th>
                <th>Econ</th>
                <th>Credit</th>
                <th>Suggested</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rowsHtml()}</tbody>
          </table>
        </div>
        <div class="match-meta" style="font-size:12px; margin-top:8px;">Credit range: ${min}–${max}, in 0.5 steps. Suggested values are a guide — you stay in control of the final number.</div>
        <div id="pcMsg"></div>
      </div>
    `;
  }

  function bind() {
    const container = state.container;
    if (container.dataset.pcBound) return; // delegation listener persists across re-renders
    container.dataset.pcBound = '1';
    container.addEventListener('click', (e) => {
      const sugBtn = e.target.closest('.pc-sug');
      if (sugBtn) {
        e.preventDefault();
        const pid = sugBtn.dataset.playerId;
        const player = state.players.find(p => p.player_id === pid);
        if (!player) return;
        const input = container.querySelector(`.pc-credit-input[data-player-id="${pid}"]`);
        if (input) input.value = player.suggested_credit;
        return;
      }

      const saveBtn = e.target.closest('.pc-save');
      if (saveBtn) {
        e.preventDefault();
        const pid = saveBtn.dataset.playerId;
        const input = container.querySelector(`.pc-credit-input[data-player-id="${pid}"]`);
        const value = input ? parseFloat(input.value) : NaN;
        if (!Number.isFinite(value)) {
          msg('Enter a valid number for the credit value.', false);
          return;
        }
        const { min, max } = minMax();
        if (value < min || value > max) {
          msg(`Credit value must be between ${min} and ${max}.`, false);
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        Api.updatePlayer(pid, { credit_value: value })
          .then(() => {
            const name = state.players.find(p => p.player_id === pid)?.name || 'player';
            return reload({ text: `Saved ${name}'s credit to ${value}.`, ok: true });
          })
          .catch(err => {
            msg(err.message, false);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
          });
        return;
      }

      const allBtn = e.target.closest('#pcApplyAll');
      if (allBtn) {
        e.preventDefault();
        const list = visiblePlayers().filter(p => p.matches_played > 0);
        if (list.length === 0) {
          msg('No players with stats in the current view to apply suggestions to.', false);
          return;
        }
        allBtn.disabled = true;
        allBtn.textContent = 'Applying…';
        Promise.all(list.map(p => Api.updatePlayer(p.player_id, { credit_value: p.suggested_credit })))
          .then(() => {
            return reload({ text: `Applied suggested credits to ${list.length} player${list.length === 1 ? '' : 's'}.`, ok: true });
          })
          .catch(err => {
            msg(err.message, false);
            allBtn.disabled = false;
            allBtn.textContent = 'Apply suggested credits to all shown players';
          });
        return;
      }

      const tab = e.target.closest('#pcTeamTabs button[data-team-id]');
      if (tab) {
        e.preventDefault();
        state.selectedTeamId = tab.dataset.teamId;
        renderPanel();
      }
    });
  }

  async function render(container) {
    state.container = container;
    // First pass renders straight away (players = []), then fills in once the
    // stats payload arrives - avoids a blank card while the request is out.
    renderPanel();

    if (state.teams.length === 0) {
      try {
        state.teams = await Api.listRealTeams();
      } catch (_) { /* keep whatever we have */ }
    }

    try {
      const data = await Api.getAdminPlayersStats();
      state.players = data.players || [];
      state.meta = data.credit_meta || state.meta;
    } catch (err) {
      state.container.innerHTML = `<div class="card"><p class="error-msg">${esc(err.message)}</p></div>`;
      return;
    }

    renderPanel();
    bind();
  }

  window.PlayerCredits = { render };
})();