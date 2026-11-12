# Team owner career

Create a team, choose its name and two colours, and sign two drivers, or take over an existing team. Pick which of your two cars to drive before each race. Your other driver races as AI. Team points, the grid and individual driver identities survive seat changes.

## Between race weekends

- **Team inbox:** a saved decision each round, with visible costs and effects on confidence, morale, reputation, fans, driver XP or research insight. An owned car retiring triggers an engineering situation. You can answer each situation once before qualifying.
- **Personnel:** appoint a technical director, driver coach and race engineer. Each role has two candidates; elite candidates unlock at 40 reputation. Signing fees are immediate, salaries are paid after races, and hiring requires one salary in reserve. Replacing or releasing a specialist does not refund their signing fee.
- **Driver development:** book one $220k training programme per driver per weekend. Pace and racecraft improve their AI rating; consistency lowers mechanical failure risk when they race as AI. Training arrives after a completed race. Both drivers earn race XP; higher experience levels also improve the selected player's grip. Progress belongs to the driver and persists across seasons.
- **Facilities:** retain the original income-generating headquarters and build three specialist departments. The laboratory cuts research costs and improves gains; at level three it shortens long projects. The simulator boosts training XP. The commercial studio adds income and fan growth. Every department level costs $25k per race to operate.
- **Development:** research quotes include staff, laboratory and insight bonuses. Insight is consumed when a package is commissioned; the quoted performance gain is locked for delivery. A development weekend advances two rounds of workshop work.
- **Weekend approach:** balanced preserves normal pace and risk. Attack adds pace to both cars while increasing AI mechanical risk and costing team morale. Development trades pace for workshop progress and driver experience. The selected approach applies to one weekend and resets to balanced for the next. Qualifying locks campaign decisions, staffing, training, departments and the approach for that weekend.
- **Finance:** see guaranteed next-race income after salaries and department costs, plus a bounded transaction ledger. Sponsor bonuses and headquarters income remain part of the budget.

## A season that moves

The nearest team by car performance becomes your season rival. Each race compares both teams' combined points and records a win, loss or draw. Rival teams bring seeded performance upgrades every third race, reflected in the real car ratings and AI pace.

Results change board confidence, team and driver morale, reputation and supporters. Reputation unlocks elite staff. Driver morale influences AI ratings. Meeting the board's constructors' target earns a season bonus of $800k plus $10k per confidence point. The payment happens on the last result, once; reopening the review does not pay again.

The legacy page records seven milestones: points, podium, victory, both championship titles, a season rivalry win and developing a driver to level three. Staff, departments, driver development, money, fans and milestones carry into the next season. The new season gets a fresh rival, reopens recruitment and resets its development programme.

## Existing saves and reliability

Older careers initialize the new state when opened. Existing money, results, grids, hires, team identity and car upgrades remain intact. Known historical wins, podiums and titles are recognized without replaying their payments. Current-season recorded races provide race XP and reconstruct the rivalry score. Nested campaign data is validated and bounded on load.

Mechanical risk applies to AI-controlled cars; the player's selected car is never scripted to retire. Staff and department running costs are settled once per recorded round. If funds cannot cover operations, available cash is charged and staff are released, with an explanation in the inbox; no hidden debt is created.

Implementation: `src/career/dynasty.ts` holds the persistent simulation, `career.ts` connects it to the actual race field/results/season transition, and `owner.ts` connects research and finances. UI: `src/ui/careerCampaign.ts` and `campaign.css`. Regression coverage includes real browser hiring, training, decisions, department upgrades, reload persistence, qualifying locks and mobile navigation.
