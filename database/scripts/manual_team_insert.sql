-- ============================================================
-- Manually insert a fantasy team for a user, using the user's
-- email and player NAMES instead of raw UUIDs.
--
-- IMPORTANT: this bypasses every check the app normally does
-- (squad size, 4-7 per team, credit limit, selection deadline).
-- Make sure your list of names is actually valid before running,
-- or the team could produce a broken/invalid points total later.
-- ============================================================

DO $$
DECLARE
  -- ---- EDIT THESE FOUR VALUES ----
  v_match_id uuid := 'PASTE-MATCH-ID-HERE';
  v_user_email text := 'user@example.com';
  v_player_names text[] := ARRAY[
    'Player One','Player Two','Player Three','Player Four',
    'Player Five','Player Six','Player Seven','Player Eight',
    'Player Nine','Player Ten','Player Eleven'
  ];
  -- Names here get marked as special players, IN ORDER (1st = Captain-
  -- style multiplier, 2nd = Vice-Captain-style, etc, per this match's
  -- special_rules.multipliers). Leave empty ARRAY[]::text[] if this
  -- match doesn't use special players.
  v_special_player_names text[] := ARRAY['Player One'];
  -- ---------------------------------

  v_user_id uuid;
  v_user_team_id uuid;
  v_player_id uuid;
  v_rank int;
  v_name text;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE email = v_user_email;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found with email %', v_user_email;
  END IF;

  INSERT INTO user_teams (user_id, match_id, submitted_at, is_locked)
  VALUES (v_user_id, v_match_id, now(), false)
  ON CONFLICT (user_id, match_id) DO UPDATE SET submitted_at = now()
  RETURNING id INTO v_user_team_id;

  DELETE FROM user_team_players WHERE user_team_id = v_user_team_id;

  FOREACH v_name IN ARRAY v_player_names LOOP
    SELECT p.id INTO v_player_id
    FROM players p
    JOIN matches m ON m.id = v_match_id
    WHERE p.name = v_name
      AND p.real_team_id IN (m.team_a_id, m.team_b_id);

    IF v_player_id IS NULL THEN
      RAISE EXCEPTION 'Player "%" not found on either team for this match - check spelling', v_name;
    END IF;

    v_rank := array_position(v_special_player_names, v_name);

    INSERT INTO user_team_players (user_team_id, player_id, special_rank)
    VALUES (v_user_team_id, v_player_id, v_rank);
  END LOOP;

  RAISE NOTICE 'Team saved for % - % player(s) inserted', v_user_email, array_length(v_player_names, 1);
END $$;
