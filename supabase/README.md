# Cloud saves (Supabase)

Everything the game saves (settings, saved tracks, best laps and ghosts) is also kept in Supabase, one row per player in `public.saves`, so progress survives a cleared browser and follows the player:

- **CrazyGames:** a logged-in player's save is filed under their CrazyGames account. The game asks the SDK for the player's signed token, and the `cg-save` function checks it against CrazyGames' public key before it reads or writes their row (`cg:<CrazyGames userId>`). Guests keep what CrazyGames' own data module keeps.
- **Web (GitHub Pages):** each browser signs in to Supabase anonymously (no sign-up) and can read and write only its own row (`sb:<user id>`).

At start-up the game waits up to 4 s for the cloud save and uses it if it's newer than this device's. After that, changes are sent 5 s later and when the page is hidden. The newest save wins. If Supabase can't be reached, or isn't set up, the game just uses what's on the device.

## Setting it up

All of it can be done in the Supabase dashboard; the CLI is optional.

1. **Allow anonymous sign-ins** (for the web version): *Authentication* → *Sign In / Providers* → turn on *Allow anonymous sign-ins*.
2. **Create the table**: *SQL Editor* → *New query* → paste all of [`migrations/20261109120000_saves.sql`](migrations/20261109120000_saves.sql) → *Run*. It should say "Success. No rows returned", and *Table Editor* then shows a `saves` table.
3. **Deploy the CrazyGames function**: *Edge Functions* → *Deploy a new function* → *Via Editor*.
   - Name it exactly `cg-save`.
   - Replace the example code with all of [`functions/cg-save/index.ts`](functions/cg-save/index.ts), which is one self-contained file. Then click *Deploy function*.
   - Then, in the function's *Details* (or settings), **switch off "Verify JWT" / "Enforce JWT verification"** and save.
     - The function checks the CrazyGames token itself.
     - The game calls it with the publishable key, which isn't a JWT, so with verification on every call would be refused.
   - Once CrazyGames has given the game its id, add it under *Edge Functions → Secrets* as `CG_GAME_ID`, so only tokens for this game are accepted.
   - With the CLI instead (the command-line tool, not the `supabase` Python package):

     ```
     npx supabase login
     npx supabase link --project-ref YOUR-PROJECT-REF
     npx supabase functions deploy cg-save --no-verify-jwt
     ```

     `npx` needs Node.js. On Windows, Scoop works too: `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git`, then `scoop install supabase`.
4. **Tell the game where the project is**: `.env` holds the *Project URL* and the **publishable** key (`sb_publishable_…`), both from *Project Settings → API Keys*. A legacy *anon* key also works, as `VITE_SUPABASE_ANON_KEY`. Then rebuild (`npm run build`, `npm run package:cg`).
   - These two values are public by design: they ship in the game, and row-level security protects the data.
   - **Never** put a secret key (`sb_secret_…`) or the `service_role` key in the game. The function gets the project's secret key from Supabase itself.

## Good to know

- **Free projects pause** after a week without activity. A paused project means saves stay on each device until it's resumed, so consider a paid plan for launch.
- **Anonymous sign-in rate limit:** Supabase allows 30 per hour per IP address by default (*Authentication → Rate Limits*). Raise it if many players share a network, such as a school.
- **Size:** a save is at most about 1.9 MB (the game keeps it well under 1 MB).
- **Privacy:** the table holds a CrazyGames user id or an anonymous id, plus game data, with no names or emails. Mention cloud saves in the game's privacy information.
- **Testing the function:** `curl -H "apikey: sb_publishable_…" -H "x-cg-token: TOKEN" https://YOUR-PROJECT-REF.supabase.co/functions/v1/cg-save`. Without a token it answers 401 `missing x-cg-token`, which shows it's deployed. On localhost, the CrazyGames SDK in local mode gives a test token.
