# Cloud saves (Supabase)

Everything the game saves (settings, saved tracks, best laps and ghosts) is also kept in Supabase, one row per player in `public.saves`, so progress survives a cleared browser and follows the player:

- **CrazyGames:** a logged-in player's save is filed under their CrazyGames account. The game asks the SDK for the player's signed token, and the `cg-save` function checks it against CrazyGames' public key before it reads or writes their row (`cg:<CrazyGames userId>`). Guests keep what CrazyGames' own data module keeps.
- **Web (GitHub Pages):** each browser signs in to Supabase anonymously (no sign-up) and can read and write only its own row (`sb:<user id>`).

At start-up the game waits up to 4 s for the cloud save and uses it if it's newer than this device's. After that, changes are sent 5 s later and when the page is hidden. The newest save wins. If Supabase can't be reached, or isn't set up, the game just uses what's on the device.

## Setting it up

1. **Allow anonymous sign-ins** (for the web version): Supabase dashboard → *Authentication* → *Sign In / Providers* → turn on *Allow anonymous sign-ins*.
2. **Create the table**: dashboard → *SQL Editor* → paste and run [`migrations/20261109120000_saves.sql`](migrations/20261109120000_saves.sql). Or, with the [Supabase CLI](https://supabase.com/docs/guides/cli): `supabase link --project-ref YOUR-PROJECT-REF` then `supabase db push`.
3. **Deploy the CrazyGames function** (needs the CLI):
   ```
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase functions deploy cg-save
   ```
   Once CrazyGames has given the game its id, also run `supabase secrets set CG_GAME_ID=<that id>` so only tokens for this game are accepted.
4. **Tell the game where the project is**: copy `.env.example` to `.env` and fill in the *Project URL* and the *anon public* key from *Project Settings → API*. Then rebuild (`npm run build`, `npm run package:cg`). These two values are public by design; **never** use the `service_role` key in the game.

## Good to know

- **Free projects pause** after a week without activity. A paused project means saves stay on each device until it's resumed, so consider a paid plan for launch.
- **Anonymous sign-in rate limit:** Supabase allows 30 per hour per IP address by default (*Authentication → Rate Limits*). Raise it if many players share a network, such as a school.
- **Size:** a save is at most about 1.9 MB (the game keeps it well under 1 MB).
- **Privacy:** the table holds a CrazyGames user id or an anonymous id, plus game data, with no names or emails. Mention cloud saves in the game's privacy information.
- **Testing the function:** `curl -H "apikey: ANON" -H "Authorization: Bearer ANON" -H "x-cg-token: TOKEN" https://YOUR-PROJECT-REF.supabase.co/functions/v1/cg-save`. On localhost, the CrazyGames SDK in local mode gives a test token.
