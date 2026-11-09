# BrowserQuest — Modernization Update Log

## Tasks completed

1. **Replaced the dead WebSocket dependency**
   - `websocket-server` (miksago) was unpublished from npm (confirmed 404) and is
     incompatible with modern Node.js.
   - Rewrote `server/js/ws.js` on the maintained `ws@8.18.0` package, keeping the
     same public API (`MultiVersionWebsocketServer`, `Connection` with `send`,
     `sendUTF8`, `close`, `onClose`, `listen`).
   - `/status` HTTP endpoint retained on the same port using Node's built-in `http`.
   - Dropped obsolete draft-75/76 / Worlize handshake code and `url.parse()`
     (replaced with WHATWG `URL`).

2. **Fixed Node.js API removals**
   - `server/js/map.js`: `path.exists()` (removed in modern Node) → `fs.existsSync()`,
     plus error handling for `fs.readFile`.

3. **Dependency management**
   - Removed floating `">0"` version ranges (which pulled breaking versions).
   - Pinned: `underscore@1.8.3` (retains legacy aliases `_.include`, `_.any`,
     `_.detect`, `_.first` used throughout the server), `log@1.4.0`, `bison@1.1.1`,
     `ws@8.18.0`, `sanitizer@0.1.3`, `memcache@1.12.0`.
   - Added `http-server@14.1.1` (devDependency) for serving the client.
   - Added npm scripts: `start` (game server) and `client` (static server).

4. **Configuration files**
   - `client/config/config_local.json` → `{ host: localhost, port: 8000 }`.
   - `client/config/config_build.json` → needed because `client/js/config.js`
     loaded it unconditionally.
   - `server/config_local.json` → local server config (metrics disabled).
   - Notably these are covered by `.gitignore` (`config_local*`, `config_build.json`);
     the `-dist` templates remain tracked.

5. **Client robustness**
   - `client/js/config.js`: made `config_build.json` optional (async load with
     try/catch) so a fresh clone loads without it.

6. **Documentation**
   - Rewrote root `README.md` with modern run steps.
   - Updated `server/README.md` (dependencies, run-from-project-root note).
   - Updated `client/README.md` (serve from project root so `shared/` is reachable).

7. **Integrated static client server into the game server (single port)**
   - Added `server/js/static.js`: safe static file server with MIME types and
     path-traversal protection (rejects `..` escapes with 403).
   - Updated `server/js/ws.js`: the HTTP server now serves the `client/`
     directory at `/`, maps `/shared/*` to the repository `shared/` directory,
     keeps `/status`, and returns 405 for non-GET/HEAD.
   - Client is now reachable at `http://localhost:8000/` — one process, one port.
   - `npm run client` retained as an optional fallback (separate static server).

8. **Inventory & equipment system + barebone HUD**
   - Added message types `INVENTORY`(27), `EQUIP_ITEM`(28), `UNEQUIP`(29) to
     `shared/js/gametypes.js`.
   - Server (`server/js/player.js`):
     - New `player.inventory` array of owned armor/weapon kinds.
     - Looting an armor/weapon now calls `addToInventory(kind)` instead of
       auto-equipping unconditionally: the item is always added; it is
       auto-equipped only if strictly better than what is equipped.
     - `equipFromInventory(kind)` (client-driven) validates ownership before
       equipping; `unequipSlot()` falls back to base gear (cloth armor / sword1)
       so a sprite always exists.
     - New `Messages.Inventory` (`server/js/message.js`) sends
       `[INVENTORY, [ownedKinds...], weaponKind, armorKind]` whenever gear or
       inventory changes; sent on join.
     - `server/js/format.js` validates the two new client messages.
   - Client protocol (`client/js/gameclient.js`): `INVENTORY` handler,
     `onInventory`, `sendEquipItem`, `sendUnequip`.
   - Client state (`client/js/game.js`): stores `inventory`,
     `equippedWeapon`, `equippedArmor`; exposes `onInventoryChange`,
     `getInventory`, `getEquippedWeapon`, `getEquippedArmor`, `equipItem`,
     `unequipItem`. Also exposes `window.app` / `window.game` for console
     debugging.
   - Client loot logic: `client/js/player.js` no longer throws for duplicate or
     weaker items (they are kept in the inventory); `client/js/item.js`
     `onLoot` only applies the optimistic swap when the item is better, matching
     the server.
   - **Barebone HUD** (`client/index.html`, `client/css/main.css`,
     `client/js/app.js`, `client/js/main.js`): click the weapon/armor icons or
     press `I` to open an inventory panel listing owned weapons/armors with
     equipped slots; clicking an item equips it. `Esc`/close dismisses it.

9. **Fix: equipped armor/weapon not reflected on the player sprite**
   - Root cause: `entity.setAnimation()` early-returns when the animation name is
     unchanged (`idle_down`), so after `setSprite()` the old animation object kept
     using the previous sprite sheet's frame data; the armor change was invisible.
   - `Player.switchArmor` now clears `currentAnimation` and replays `idle()` after
     `setSprite()`, rebuilding frames from the new sprite (also keeps `spriteName`
     in sync).
   - `game.onPlayerEquipItem` routes armor through `switchArmor` and, for weapons,
     clears the animation and idles so the (separately rendered) weapon sprite
     updates.

10. **Inventory persistence across refresh / re-login**
    - Root cause: the client only persisted the *equipped* armor/weapon names in
      localStorage (`player.armor` / `player.weapon`); the inventory itself was
      never saved. On login HELLO carried only those two kinds, and the server
      seeded the inventory with just them, so all other collected items were lost
      and it appeared to "revert to best equipment".
    - `client/js/storage.js`: added `player.inventory` and
      `setPlayerInventory` / `getPlayerInventory`.
    - `client/js/game.js`: `onInventory` now persists the full inventory and the
      equipped kinds; `sendHello` passes the persisted inventory.
    - `client/js/gameclient.js`: `sendHello(player, inventory)` appends the
      inventory as a 4th (optional) HELLO parameter.
    - `server/js/format.js`: `HELLO` accepts an optional 4th argument (array);
      `checkHello` only requires it to be an array (contents are sanitized later).
    - `server/js/player.js`: `buildInventoryFromHello` seeds the inventory from
      the persisted list, filters unknown/foreign kinds, dedupes, and always
      includes the equipped items. Added `isArmorOrWeaponKind` guard (fixes a
      crash where `Types.isArmor(unknownKind)` threw) used by `addToInventory`,
      `equipFromInventory`-adjacent paths, and `unequipSlot`.

11. **Fix: self-initiated equips weren't visually applied; login portrait stale**
    - Root cause (visual): `Player.broadcast(message)` defaults `ignoreSelf = true`,
      so the equipping player never received their own `EQUIP` message. The old
      loot path masked this with an optimistic local swap, but equipping from the
      inventory panel had no such swap, so the sprite only updated on re-login.
      Added `broadcastEquip(kind)` → `broadcast(equip, false)` (includes self) and
      used it in `addToInventory`, `equipFromInventory`, and `unequipSlot`.
    - Root cause (login portrait): the load-character screen shows a stored PNG
      (`player.image`) captured at save time. Equipping changed the kind fields but
      never regenerated the image, so the screen kept showing the old combo.
      Added `Game.savePlayerPortrait()` (regenerates via
      `renderer.getPlayerImage()`), called from `onPlayerEquipItem` for the local
      player and from `onInventory` once the player is loaded. The equip message
      also now updates the sprite immediately for the local player.

12. **Fix: inventory HUD item sprites squeezed; add numeric HP readout**
    - Item sprite sheets are horizontal strips of 6 frames (`item-*.png` is
      96/192/288 px wide at scale 1/2/3). The CSS used `background-size:<box> <box>`,
      compressing all 6 frames into one icon box (the "row of 6 squeezed sprites").
      Changed `.inv-icon` (24x24) and `.equip-slot` (32x32) to
      `background-size:600% 100%; background-position:left center`, so the sheet is
      drawn 6× the box width and the box shows only frame 0 (a single icon).
    - Added a numeric HP readout: `#hp-text` span inside `#healthbar`
      (`index.html`), styled to overlay the bar (`main.css`, per-breakpoint font
      sizes) and updated in `app.initHealthBar`'s health callback as
      `current/max`.

13. **HP text right-aligned; conditional (out-of-combat) regeneration**
    - HP readout moved to the right-most edge of the HP bar:
      `#hp-text { justify-content:flex-end; padding-right:... }` (per-breakpoint
      padding), replacing the centered layout.
    - Regen rework: players now have a **base healing rate of 0**. Added
      `Player.canRegen()` = not targeted by any enemy (`attackers` empty) **and**
      no movement for more than 2 seconds (`Date.now() - lastMoveTime > 2000`).
      `lastMoveTime` is updated on `MOVE`, `LOOTMOVE`, and `TELEPORT`.
    - `worldserver.js` regen tick: players only `regenHealthBy(maxHp/25)` (the
      "current level" rate) and receive a HEALTH update when `canRegen()` is true;
      otherwise no heal. Mobs keep their original regen behaviour.

14. **Mob HP bar for aggressive (aggro-triggered) mobs**
    - Server: `Messages.Damage` now serializes
      `[DAMAGE, entityId, points, currentHitPoints, maxHitPoints]` so the attacking
      player's client learns the mob's remaining/max HP.
    - Client protocol: `gameclient.receiveDamage` forwards `(id, dmg, hp, maxHp)`.
    - Client state (`game.js`): on damage, stores `mob.hitPoints` /
      `mob.maxHitPoints`; on `ATTACK` where a mob targets the local player, marks
      `mob.aggroed = true` (defaults to 100/100 full until real HP arrives).
    - Renderer (`renderer.js`): added `Mob` dependency and `drawMobHealthBar()`,
      called from `drawEntity` for mobs that are attacking/aggroed or damaged
      (and not dead/fading). The bar is drawn in screen space centred just above
      the sprite: dark border, dark-red empty track, red fill proportional to HP.

15. **Fix: mob HP bars never rendered; add targeted-mob HP bar**
    - **Bug (small bars invisible):** the draw condition included `!entity.isFading`.
      On desktop, `Entity.addEntity()` calls `entity.fadeIn()`, which sets
      `isFading = true` and is *never* cleared — so every entity stays "fading"
      and the bar was permanently suppressed. Removed the `isFading` gate (fading
      is only a visual alpha effect, not a "disappearing" state); the bar now
      keys on `isAttacking() || aggroed || damaged`.
    - **Mob max HP source:** client mobs started with `hitPoints/maxHitPoints = 0`
      and only learned HP on first damage, so an aggro'd-but-unhit mob had no
      usable values. `Mob.getState()` (server) now appends
      `[orientation, target, hitPoints, maxHitPoints]`, and the client
      `receiveSpawn` reads `data[7]`/`data[8]` into the mob.
    - **Targeted-mob HP bar (full-sized, with numbers):** the player's existing
      single `target` (`player.target`, set by `makePlayerAttack`) drives a new
      HUD element `#target-bar` placed just above the player HP bar. It shows the
      mob name, a filled track, and `current/max`. Added
      `Game.refreshTargetBar()` (called each tick + on target/damage updates,
      signature-throttled) and `App.updateTargetBar(mob)`. Hidden when there is no
      living mob target.

16. **HP bar refinements**
    - Short mob bar: fixed length `24 * scale` (independent of sprite width), so
      every mob's bar is the same length. (Previously it scaled with the mob's
      sprite width, so different mobs had different bar lengths.)
    - Target mob bar: made thicker (per-breakpoint heights 16/12/9 px) and the
      fill is bright red (`#e02020`, same idea as the player HP bar). Fixed a bug
      where the fill had zero height (the flex track had no height, so only the
      dark track showed as a "solid black bar"): the track now `align-self:stretch`
      and the fill fills it, so red is visible for a non-reduced bar and narrows
      as HP drops.

17. **Fix: equip-switch HP exploit (free full heal)**
    - Root cause: gear changes called `Player.updateHitPoints()`, which is
      `resetHitPoints(max)` → sets `hitPoints = maxHitPoints` (a full heal). The
      client's `onPlayerChangeMaxHitPoints` also did `hitPoints = hp`, refilling on
      the max-HP message sent for armor changes.
    - Added `Player.updateMaxHitPoints()`: recomputes max HP from armor level and
      preserves current HP (clamped to the new max) without healing; used by
      `equipItem`, `equipFromInventory`, and `unequipSlot` armor paths. Weapon
      paths never touch HP.
    - Client `onPlayerChangeMaxHitPoints` now only updates `maxHitPoints` and
      clamps `hitPoints` — it no longer refills.
    - Result: switching **weapon** changes nothing HP-wise; switching **armor**
      changes only the maximum (current HP carried over / clamped). Spawn and the
      firepotion effect still intentionally set full HP.

18. **Data-driven equipment system + editor (with loader)**
    - New source of truth: `shared/data/equipment.json` (+ JSON Schema
      `shared/data/equipment.schema.json`). Declares equipment categories in
      `types` (currently `weapon`, `armor`) and holds `weapons`/`armors` arrays;
      any future category (e.g. `deco`, `ring`) is added by declaring it in
      `types` and adding the matching plural array.
    - New loader `shared/js/equipment.js` (works in Node and browser): normalizes
      the JSON into a registry, registers kinds into `Types`
      (`Types.registerKind`), builds `Types.rankedWeapons`/`rankedArmors`, and
      exposes `getItem/getLevel/getRank/getMaxHitPoints/getLootMessage/
      getSpriteName/getItemSpriteName/getTypes/getTypeItems`.
    - `shared/js/gametypes.js`: added `Types.registerKind()` and
      `Types.getTypeOf()`; made `kinds.getType()` tolerate unknown kinds.
    - Server: `server/js/properties.js` reads levels/max HP from the loader
      (`getArmorLevel`, `getWeaponLevel`, new `getMaxHitPoints`); `player.js`
      uses `Properties.getMaxHitPoints(armor)` for max HP.
    - Client: `game.js` derives the sprite list from the loader (new equipment
      sprites auto-load); `item.js` uses loader sprite/loot names; `app.js` lists
      inventory by category using `Types.getTypeOf` and item-sprite names.
    - Build tool `tools/equipment/build.js` (+ `npm run equipment:build`, and a
      `prestart` hook): validates the JSON (ids, names, ranks, type match,
      duplicate detection, sprite existence) and regenerates
      `shared/js/equipment-data.js`, `client/js/items.generated.js`, and
      `client/js/sprites.generated.js`.
    - Consumables (flask/cake/burger/firepotion) remain hand-defined in
      `client/js/items.js`; chest and NPC builders unchanged.
    - Docs: `tools/equipment/README.md` — full editor guide (schema, creating/
      editing items, ids, sprites, new categories, loader internals, validation).

19. **Fix: renamed equipment broke HUD names + chest loot after `equipment:build`**
    - Symptom: after editing `equipment.json` (display names like `Steel_Sword`,
      `Travel_Clothes`) and rebuilding, the inventory HUD kept the old names and
      chest loot produced nothing (client threw `Error` on the spawned item).
    - Root cause A (duplicate kinds): the loader registered each equipment name
      as an extra `kinds` entry while the original static name already existed,
      so every equipment id had **two** kind names. Code that uses the kind name
      as the **sprite key** (`Types.getKindAsString` → `getKindAsString` used by
      `entity.getSpriteName`, `gameclient` sprite/weapon names, hurt-sprite setup)
      got an inconsistent name, and `initHurtSprites` threw.
    - Root cause B (loader ran too early on the client): `equipment.js` captured
      `window.Types` at script-evaluation time, before `gametypes.js` defined it,
      and `load()` short-circuited on the cached registry, so `Types.Entities.*`
      enum constants (e.g. `STEEL_SWORD`) were never installed in the browser.
      `EntityFactory` then registered item builders under `undefined`, so chest
      drops could not be created client-side ("gives nothing").
    - Fix:
      - `gametypes.js`: `registerKind` no longer adds a second `kinds` entry for
        an id that already has a canonical (asset) name; the display name is
        recorded as an **alias** (`Types._kindAliases`) used only by
        `getKindFromString`. Added `Types.findKindNameById`.
      - `equipment.js`: resolve `Types` lazily (not at IIFE time) and make
        `load()` always (re)install kinds/ranks into the current `Types`, while
        caching only the normalized registry.
      - `entityfactory.js`: depends on `equipment` (ensures loader ran) and
        resolves builder kinds robustly (enum → registry by name → kind lookup).
      - `app.js`: inventory HUD labels use the equipment **display name**
        (`getItemDisplayName`, turning `Steel_Sword` into "Steel Sword") instead
        of the sprite/asset key.
      - Build: item builder metadata now carries `name` for robust resolution.

20. **Mob heals to full when its last attacker vanishes (death/logout/teleport)**
    - Requirement: if a mob is targeted by only one player and that player dies,
      the mob recovers to full health. Extended (per owner) to also apply on
      logout, and on teleport; NOT on zone/room changes (whole open world is one
      room for now). Healing happens **only after the mob finishes returning** to
      its spawn point.
    - Design choice for client sync: a dedicated **state** message
      (`MOB_HEALTH`, type 30) rather than despawn/respawn (c) — chosen because a
      future EXP system tracks kills via mob deaths; a respawn event could be
      confused with a kill/spawn, whereas a state update is unambiguous and keeps
      each mob's identity stable.
    - Server:
      - `Mob.returnToSpawningPosition(wait, healOnArrival)`: after arriving, if
        `healOnArrival` and the mob still has no haters and is below max HP,
        restore `hitPoints = maxHitPoints` and fire `onHealthChange`.
        `forgetPlayer`/`forgetEveryone` request healing on return; a re-aggro
        during the return cancels the heal (hatelist non-empty on arrival).
      - `Mob.onHealthChange` callback; `WorldServer.addMob` wires it to broadcast
        `Messages.MobHealth` to the mob's adjacent groups.
      - `WorldServer.detachPlayerFromAttackers(player)` extracted from
        `handlePlayerVanish`; called on death/teleport (via `handlePlayerVanish`)
        and now also on **logout** (`removePlayer`).
      - `Messages.MobHealth` → `[MOB_HEALTH, id, hitPoints, maxHitPoints]`.
    - Client: `gameclient.receiveMobHealth` + `onMobHealthChange`;
      `game.js` updates the mob's `hitPoints`/`maxHitPoints` and refreshes the
      target bar (the small bar hides automatically when HP is full).

21. **Experience / level / stat system (linear curves)**
    - New shared module `shared/js/levels.js` (Node + browser):
      - Level cap **255**; linear XP curve `xpToNext(n) = 50 + (n-1)*50`; helpers
        `totalXPForLevel`, `progressForXP`, `levelForXP`.
      - Stats (8): `vigor, mind, endurance, strength, dexterity, intelligence,
        faith, arcane`; level-1 baseline **10** for all. Linear auto-growth per
        level (Vigor/Strength grow faster), **plus** 1 manual point per level.
      - `computeStats`, `availablePoints`, `sanitizeAllocation`, `sanitizeXP`.
      - Combat integration: `maxHitPoints = (armorBase + (vigor-10)*HP_PER_VIGOR) *
        multiplier` (multiplier reserved for class/armor, currently 1);
        `attackPower = weaponLevel * (1 + (strength-10)*ATK_PER_STRENGTH) *
        multiplier`. Vigor/Strength wired; other stats stored/displayed only.
      - Cooperative split `splitKillXP(baseXP, members)`: base XP split by party
        size; **higher-level players get a larger discount, lower-level players a
        smaller discount (larger share)**; total awarded ≈ base XP.
    - `server/js/properties.js`: added base `xp` per mob (rat 8, crab 14, bat 16,
      goblin 20, skeleton 45, snake 60, wizard 70, ogre 90, skeleton2/eye 100,
      spectre 150, deathknight 160, boss 600).
    - `server/js/player.js`: progression state (`totalXp`, `level`, `allocated`,
      `stats`); `recomputeProgression`, `applyProgressionFromHello`,
      `sendProgression`, `gainXP` (level-up refills HP + notifies),
      `allocateStatPoint`; `computeMaxHitPoints`/`attackPower` use stats; damage
      now uses `attackPower()`.
    - `server/js/worldserver.js`: `awardKillXP(mob, attacker)` awards XP to every
      player in the mob's hatelist (treated as one party), called on mob death.
    - Protocol: `PROGRESSION` (31) server→client snapshot
      `[PROGRESSION, totalXp, level, xp, xpToNext, availablePoints, maxHitPoints,
      vigor..arcane]`; `ALLOCATE_STAT` (32) client→server `[index, points]`.
      `HELLO` extended with an optional 5th field (progression object); validated
      by `format.checkHello`.
    - Client: `gameclient` PROGRESSION handler / `onProgression` /
      `sendAllocateStat`; `game.js` stores progression + `allocated`, sends it in
      HELLO, persists via `storage.setPlayerProgression`; `app.updateProgression`
      renders **level text + XP bar + stat-point indicator** inside the canvas
      border (top-left); minimal `+` button allocates into Vigor (index 0) as a
      placeholder. Persistence is localStorage + server-side validation (clamped).

22. **Full stat-allocation panel with HUD**
    - Added a **Character** panel (`#stats-panel`) styled like the inventory
      overlay: shows level, points available, and a row per stat (Vigor, Mind,
      Endurance, Strength, Dexterity, Intelligence, Faith, Arcane) with the
      current total, the manually-allocated `+N`, and a `+` button.
      Stat names have tooltips describing their (current/future) effect.
    - Opened via a new **Stats** button in the level display, by clicking the
      level text, or the `C` key. Closed via its `×`, `C`, `Esc`, or
      `app.hideWindows()`. The panel refreshes on every `PROGRESSION` update.
    - `+` buttons call `game.allocateStat(index, 1)` (server-authoritative):
      the server validates available points, recomputes stats, sends the new
      `PROGRESSION`; Vigor allocations raise max HP (current HP carried over,
      not healed). Buttons are disabled when no points remain.
    - Removed the old placeholder `+`/Vigor-only button.

23. **Fix: Character panel close button did not close (double-toggle)**
    - Root cause: the stats panel's close button had its own handler
      (`app.toggleStats()`), but the panel's `.close` element *also* matched the
      global `$('.close')` handler bound earlier (`app.hideWindows()`). One click
      fired both: `hideWindows()` closed the panel, then `toggleStats()`
      immediately re-opened it — net no change. (jQuery reported 2 click handlers
      on `#stats-panel .close`.)
    - Fix: removed the redundant `#stats-panel .close` handler; the panel is now
      closed solely by the shared `$('.close')` → `app.hideWindows()` path (which
      already removes the stats panel's `active` class). Outside-click closing
      (via the foreground handler → `hideWindows()`) is unchanged.
    - Verified: `#stats-panel .close` now has exactly 1 click handler; clicking it
      closes the panel; `hideWindows()` closes it; no regressions.

24. **Configurable NPC tool (data-driven NPCs)**
    - New source of truth `shared/data/npcs.json` (+ `npcs.schema.json`). Each NPC
      has: `id`, `name` (displayed name), `kind` (sprite), `x`/`y` (grid coords),
      `conversations` (array), `events` (array; reserved for the future shop), and
      optional `idleSpeed`.
    - New loader `shared/js/npcs.js` (Node + browser): `getAll`, `getById`,
      `getAt(x,y)`.
    - Build tool `tools/npcs/build.js` (+ `npm run npcs:build`; added to
      `prestart`): validates ids/names/kinds/coords/conversations/events and
      generates `shared/js/npcs-data.js`.
    - Server: `worldserver.js` gains `spawnNpcs()` which spawns NPCs from the data
      (map `staticEntities` NPC tiles are now ignored); `addNpc` attaches the
      config.
    - Client: `client/js/npc.js` `talk()` / new `getDisplayName()` / `getEvents()`
      read from the shared data matched by grid position (fallback to kind);
      `client/js/npcs.js` reads `idleSpeed` from data; renderer draws NPC display
      names.
    - Ported all 23 original BrowserQuest NPCs (10 guards, king, villager,
      village girl, priest, scientist, agent, rick, nyan, sorcerer, octocat, coder,
      beach, desert) with their original dialogue.
    - Docs: `tools/npcs/README.md`; `tools/README.md` lists the NPC tool.

25. **Coordinate readout (top-right of the game)**
    - Adds `#coords-display` inside the canvas border, top-right, showing the
      player's current grid position (`x, y`). Intended to help pick warp-point
      coordinates for the future teleport feature. (Checkpoint/respawn and login
      spawn logic are left untouched — to be revamped later.)
    - `game.js` `updateCoordsDisplay()` is called from the tick loop and only
      touches the DOM when the player's grid position changes.

26. **Inventory/Equipment split + Gold + Village Girl shop (shop foundation)**
    - **Two subsystems**: `equipment` (unique gear kinds, equippable, one entry
      each) and `inventory` (stackable item counts: consumables, shop items and
      **duplicate gear**). Picking up a gear kind you already own now routes the
      extra copy to the sellable inventory stack instead of discarding it.
    - **Gold**: new persisted stat (no starting gold, no mob drops). Earned by
      selling inventory items at a shop.
    - **Wire protocol**: `INVENTORY` extended to
      `[INVENTORY, equipment[], weapon, armor, {kind:count}, gold]`. New message
      types `BUY_ITEM` (33) and `SELL_ITEM` (34); `format.js` validates both.
      HELLO 4th field may be `{equipment, inventory, gold}` (legacy array still
      accepted and migrated).
    - **Teleport item**: new object kind `teleportscroll` (id 56), storable in
      inventory, buyable + persisted but **not usable yet** (teleport itself is a
      later phase). Placeholder icon reused from the flask spritesheet.
    - **Shop data**: `npcs.json` `events` now supports
      `{type:"shop", items:[{kind, price}]}`; schema + `tools/npcs/build.js`
      validate it. Village Girl sells a teleport scroll for 25 gold. Extensible to
      any NPC.
    - **Sell prices**: data-driven `sellPrice` per equipment item (schema +
      `tools/equipment/build.js` preserved in registry); objects/consumables use
      a table in `properties.js`. Fallbacks: gear `rank*5`.
    - **Server**: `applyPersistedLoadout`, `addLootToInventory`,
      `addStackableItem`/`removeStackableItem`, `hasInEquipment`;
      `buyItem`/`sellItem` resolve the shop by scanning NPCs within 2 tiles of the
      player (server-authoritative gold/loot), with chat notices on failure.
    - **Client**: `#shop` HUD (Buy + Sell lists, gold readout) opened from
      `makeNpcTalk` when the NPC has a shop event; inventory panel split into
      Equipment (equippable) and Items (stacked counts xN) with a gold line.
      `hideWindows()` closes the shop. Persistence via `storage.js`
      `player.loadout`.
    - **Files**: `server/js/player.js`, `server/js/message.js`,
      `server/js/format.js`, `server/js/properties.js`, `shared/js/gametypes.js`,
      `shared/js/equipment.js`, `shared/js/npcs.js`, `shared/data/npcs.json`,
      `shared/data/npcs.schema.json`, `shared/data/equipment.schema.json`,
      `tools/npcs/build.js`, `client/js/game.js`, `client/js/gameclient.js`,
      `client/js/app.js`, `client/js/main.js`, `client/js/npc.js`,
      `client/js/storage.js`, `client/index.html`, `client/css/main.css`,
      `client/sprites/item-teleportscroll.json` (+ placeholder PNGs in
      `client/img/{1,2,3}`), and regenerated `shared/js/npcs-data.js`,
      `shared/js/equipment-data.js`, `client/js/items.generated.js`,
      `client/js/sprites.generated.js`.

27. **Warp item usable + NPC conversation options (shop no longer auto-opens)**
    - **Warp item**: renamed the scroll to **[★ Initial Town]** via
      `Types.itemDisplayNames` (id 56). New message types `USE_ITEM` (35,
      client→server) and `WARP` (36, server→the warping player). `Types` gains
      `isUsableItem`, `warpDestinations` (scroll → 16,223 = initial town) and
      `itemDisplayNames`.
    - **Server** (`player.js` `useItem`): validates the item is usable + owned,
      consumes one unit, validates/repositions the player, broadcasts `TELEPORT`
      to nearby players, sends `WARP` to the user so their own client moves, then
      refreshes the entity list and inventory. Notices on failure.
    - **Client**: `gameclient.js` `sendUseItem` + `receiveWarp`/`onPlayerWarp`;
      `game.js` `useItem()` and an `onPlayerWarp` handler that repositions the
      local player, recenters the camera and resets the zone. Inventory "Items"
      rows for usable items are clickable and show a `(use)` hint.
    - **Conversation options**: clicking an NPC now **only** cycles its normal
      dialogue — it no longer opens the shop. If the NPC has a shop event, a
      separate **clickable option bubble** ("Trade") appears above the NPC;
      clicking *it* opens the shop. Non-shop NPCs show no option bubble.
      Implemented via `BubbleManager.createOption` (pointer-events on, click
      binding) + `game.showNpcOptions` / `activateNpcOption` /
      `assignOptionBubbleTo` / `repositionOptionBubbles` (per-frame camera
      follow in the tick loop).
    - **Files**: `shared/js/gametypes.js`, `server/js/message.js`,
      `server/js/format.js`, `server/js/player.js`, `client/js/gameclient.js`,
      `client/js/game.js`, `client/js/app.js`, `client/js/bubble.js`,
      `client/index.html`, `client/css/main.css`.
    - **Note**: the bundled jQuery is **1.6.4**, which lacks `.on()`; option-bubble
      handlers use `.bind()/.unbind()` accordingly.

28. **Integer damage + minimap (fixed whole-world & local zoom)**
    - **Damage rounding**: `Formulas.dmg()` now returns `Math.round(dmg)` so
      damage is always an integer (previously fractional once Strength > 10 made
      `Levels.attackPower` non-integer). HP stays integral across all hits.
    - **Minimap**: `client/js/minimap.js` builds a one-time terrain thumbnail by
      drawing the real tileset art at **3px per world tile** (supersampled → smooth
      when scaled down; addresses the earlier "accurate but ugly/aliased" 1px look).
      Two modes: **zoom** (125×125, local window ~70 tiles centred on the player,
      with a camera viewport rectangle) and **fixed** (whole **overworld** at 125px
      wide). The fixed view **crops off the dungeon/room system** on the right of
      the map (renders only x < 93 tiles of open world) per user request. Toggle
      with the `M` key or the on-map "World/Local" button.
    - **Dots**: local player = larger **blue** dot; other players + NPCs =
      **green**; mobs = **red**. Redrawn each frame in the tick loop.
    - **HUD**: minimap placed top-right inside the canvas border; `#coords-display`
      moved into a `#hud-topright` column directly underneath it.
    - **Files**: `server/js/formulas.js`, `client/js/minimap.js` (new),
      `client/js/game.js` (AMD dep + `initMinimap`/`toggleMinimapMode`/draw in
      tick), `client/js/main.js` (`M` key + toggle click + label),
      `client/index.html` (`#hud-topright`, `#minimap`, `#minimap-canvas`,
      `#minimap-toggle`), `client/css/main.css`.

29. **In-app GUI map editor (`/editor`) — Phase 0–1 (hosting, shell, tile painter, save)**
    - **Hosting**: served by the existing game HTTP server at
      `http://localhost:8000/editor` (same port, same origin). Gated by a new
      `editor_enabled` config flag (added to `server/config.json` and
      `server/config_local.json`; default off for production). `ws.js` now routes
      `GET /editor*` to a new `editor/` static root, and POST editor APIs.
    - **Backend** (`server/js/editor.js`, new): loopback/dev save API with a strict
      allow-list of writable roots (`client/maps`, `server/maps`, `shared/data`,
      `client/sprites`, `client/img`). `POST /editor/api/save` writes the client
      map JSON **and** regenerates `client/maps/world_client.js` (worker copy) plus
      the server map JSON (`restartRequired`); also accepts extra JSON files.
      `POST /editor/api/asset` writes binaries (sprite PNGs). `GET /editor/api/load`
      returns the current client map, server map and NPC data.
    - **Frontend** (`editor/index.html`, `editor/css/editor.css`,
      `editor/js/editor.js`, new): canvas-based editor at scale 2 using the real
      tilesheet. Pan (middle/right-drag), wheel zoom toward cursor, tile palette
      picker, and tools: paint, erase (per layer), toggle collision/blocking/plateau.
      **Layer-aware painting** (Base 0 / Decor 1 / Decor 2) so both open-world base
      terrain and stacked region/interior decorations can be authored. Collision
      edits are mirrored into the server map (identical flat indices). Save POSTs
      both maps; the UI reports "server restart required" for server-map changes.
    - **Docs**: `editor/README.md`; `tools/README.md` points to the new editor.

30. **Map editor Phases 2–4 (regions/triggers, NPC/mob placement, asset import) + toolbar fix**
    - **Toolbar overflow fix**: the Save status message no longer forces the
      coordinate readout off-screen. Toolbar now uses flex-wrap with a dedicated,
      width-capped, ellipsised `#status`; `body` is a flex column and `#main`
      fills remaining height (previously a fixed `calc(100% - 44px)` with a fixed
      44px toolbar). Status has a `title` tooltip for truncated text.
    - **Phase 2 — regions & triggers** (drag-rectangle tools): music areas (id,
      e.g. `cave`), checkpoints (with "starting area" → server `s:1`), roaming mob
      areas (`type`+`nb`), chest areas (item list). **Points** (click): doors/
      portals (target x/y, orientation, portal flag) written to **both** client and
      server maps; static chests; static mobs/items (`{flatIndex: kind}`).
    - **Select/move + Inspector**: right-side inspector panel; click any region,
      door, chest, static entity or NPC to edit its fields and delete it. Region and
      entity overlays are drawn (green/orange/blue/purple/yellow rects, cyan/red/
      magenta dots).
    - **Phase 3 — NPC placement**: preview NPCs; add/drag/delete them; changes are
      written to `shared/data/npcs.json` only on the explicit **Apply NPCs** button
      (then run `npcs:build`/restart). `Types` (gametypes.js) is loaded in the
      editor page for kind name↔id conversion.
    - **Phase 4 — asset import**: "Import asset…" dialog uploads a PNG or sprite
      JSON via `POST /editor/api/asset` to an allow-listed repo path.
    - **Files**: `editor/index.html` (new tools, inspector, dialog, gametypes
      script), `editor/css/editor.css` (toolbar/inspector/dialog), `editor/js/
      editor.js` (rewritten with all phases), `editor/README.md` (updated).
      Backend (`server/js/editor.js`) unchanged except already-existing
      `/editor/api/asset`.

31. **Editor select/move fixes + asset dimension reference**
    - **Static entity `Kind` field empty**: `pickAt`/`placePoint` created the
      `staticEntities` selection with only a `key`, but the inspector read `ref`
      (undefined) → empty field. Now the selection carries `ref = map.staticEntities[key]`,
      and editing the kind updates both the map and `ref`.
    - **Static entities overlapped by regions**: select/move now tests **points
      first** (NPCs → doors → static chests → static entities) and only falls back
      to enclosing regions (music/checkpoint/roaming/chest areas) when no point is
      hit. Original BQ mobs/items can now be selected and edited even inside a
      music/roaming/chest area.
    - **Docs**: `editor/README.md` gains an **asset reference** (tilesheet pixel
      sizes per scale: 320x1568 / 640x3136 / 960x4704; entity/item logical sizes
      table) to help author Phase-4 test sprites.
    - **File**: `editor/js/editor.js`.

32. **Editor sprite palette, filters, and sprite import workflow**
    - **Why imported sprites didn't appear**: the editor palette only drew the
      terrain tilesheet; it never loaded entity sprites, so imports (and stock
      sprites) had nowhere to show. Also stock convention is `id === filename`
      (the user's `test-missing.json` had `id:"mytile"`; now fixed) and
      `sprites.generated.js` is only rebuilt by `npm run equipment:build`, not a
      plain restart.
    - **Backend** (`server/js/editor.js`): `GET /editor/api/sprites` lists every
      `client/sprites/*.json` with metadata + per-scale PNG existence;
      `POST /editor/api/import-sprite` writes the JSON (forcing `id`==filename),
      the provided PNGs, and **regenerates `client/js/sprites.generated.js`** so
      the game loads the new sprite without a manual build. Routes wired in
      `ws.js`.
    - **Frontend** (`editor/`): new **sprite palette** (thumbnail grid, name
      filter); clicking a sprite sets the `kind` for Static mob/item / NPC
      placement, and those Inspector Kind fields became **sprite dropdowns** with
      a free-text override. New **tile filter**: by id (`120`, `100-150`,
      `5,9,200-205`) and a **"Only tiles used in map"** toggle (dims non-matching
      cells). New **Import sprite** dialog: id + frame w/h + idle animation + any
      of scale 1/2/3 PNG inputs; **missing scales are auto-generated** by
      down/upscaling the closest provided one (preserving the frame grid) via
      canvas; optional "this is a terrain tile" toggle (notes intent; growing the
      tilesheet + renumbering is not yet supported).
    - **Docs**: `editor/README.md` updated (API + features).
    - **Files**: `server/js/editor.js`, `server/js/ws.js`, `editor/index.html`,
      `editor/css/editor.css`, `editor/js/editor.js`.

33. **Editor UI: Tiles/Sprites palette tabs**
    - Split the left selection panel into two tabs (**Tiles** / **Sprites**) with
      tab buttons and panels; Tiles is active by default, switching shows the
      corresponding palette. Filters and interaction otherwise unchanged.
    - **Files**: `editor/index.html`, `editor/css/editor.css`, `editor/js/editor.js`.

34. **Fix sprite import `have is not defined`**
    - In `doImport` the `have`/`pngs` maps were declared inside the first
      `.then` callback but referenced in the next `.then` — out of scope, so
      the import threw `have is not defined`. Hoisted them into the `doImport`
      function scope shared by the whole promise chain. Verified end-to-end
      (provide scale-2 only -> scales 1 & 3 auto-generated, manifest regenerated).
    - **File**: `editor/js/editor.js`.

35. **Terrain tile import (composite into tilesheets) + tile name search**
    - **Why "terrain tile" imports didn't show**: the Tiles tab renders only the
      single `client/img/2/tilesheet.png` grid; the old "terrain tile" toggle was
      a no-op hint (nothing composited into the sheet or assigned an id). Imported
      files were entity sprites (Sprites tab only).
    - **Backend** (`server/js/editor.js`, `ws.js`): `POST /editor/api/import-tile`
      writes the three browser-composited tilesheet PNGs and registers the tile's
      `id->name` in `client/maps/tiles.json`; `/editor/api/load` now also returns
      `tiles`.
    - **Frontend** (`editor/`): with "This is a terrain tile" checked, the import
      composites the uploaded art into all three `tilesheet.png` at the **next free
      id** (max over map data ids AND animated frame spans + 1; appends a sheet row only when capacity is exceeded, so
      existing ids are unchanged), uploads the sheets, reloads the tileset, selects
      the new tile, and shows it in the Tiles tab. Tile filter now also searches by
      **name** (registry) and **hides** non-matching tiles; selecting a tile shows
      its name in the status bar.
    - **Converted `test-missing2` to a terrain tile**: appended as tile **#1936**
      at cell (gx16,gy96) in all three sheets (past the wave animation 1921-1935), named
      `test-missing2` in `client/maps/tiles.json`.
    - **Files**: `server/js/editor.js`, `server/js/ws.js`, `editor/index.html`,
      `editor/js/editor.js`, `editor/README.md`, `client/maps/tiles.json` (new),
      `client/img/{1,2,3}/tilesheet.png` (updated).

## Tested items

| # | Test | Result |
|---|------|--------|
| 1 | `npm install` completes | PASS — 56 packages installed |
| 2 | `npm start` boots 5 worlds + listens on :8000 | PASS |
| 3 | `/status` HTTP endpoint | PASS — `[0,0,0,0,0]` |
| 4 | WebSocket connect → receive `go` → send HELLO → receive WELCOME | PASS — WELCOME `[1,<id>,"Tester",x,y,...]` |
| 5 | Static serving of `client/index.html` | PASS — 200 |
| 6 | Static serving of `shared/js/gametypes.js` | PASS — 200 |
| 7 | Static serving of `client/config/config_local.json` | PASS — 200 |
| 8 | All 67 client sprite JSONs + `img/1..3` PNGs resolvable | PASS — no missing assets |
| 9 | Chrome headless loads client with no JS exceptions / console errors | PASS |
| 10 | Chrome headless full flow: name → Enter → join | PASS — server logged `ChromeTester has joined world1`, `/status` = `[1,0,0,0,0]` |
| 11 | Client loads even when `config_build.json` / `config_local.json` absent | PASS — no exceptions |
| 12 | Integrated server: `GET /` and `/index.html` | PASS — 200 `text/html` |
| 13 | Integrated server: `/shared/js/gametypes.js` | PASS — 200 `application/javascript` |
| 14 | Integrated server: `/config/*.json`, `/js/*.js`, `/img/*.png`, `/sprites/*.json` | PASS — 200 with correct MIME types |
| 15 | Integrated server: path traversal `..%2f..%2fpackage.json` | PASS — blocked (403) |
| 16 | Integrated server: unknown path | PASS — 404 |
| 17 | Integrated server: health check on same port | PASS — `/status` 200 `[0,0,0,0,0]` |
| 18 | Chrome headless full flow from `http://localhost:8000/` | PASS — server logged `ChromeLocal has joined world1`, `/status` = `[1,0,0,0,0]`, no exceptions/errors |
| 19 | Server inventory logic (unit): better item auto-equips | PASS — 12/12 unit checks |
| 20 | Server inventory logic: weaker/duplicate item added but not auto-equipped | PASS |
| 21 | Server inventory logic: manual equip of owned item / ignore non-owned | PASS |
| 22 | Server inventory logic: unequip armor falls back to cloth, item retained | PASS |
| 23 | `INVENTORY` message serialization layout `[type,[kinds],weapon,armor]` | PASS |
| 24 | `LOOT` wire handler → `addToInventory` + `INVENTORY` sent | PASS — 7/7 loot/wire checks |
| 25 | Chrome: press `I` opens inventory panel; starting items render | PASS — `items: ["60:Sword1","21:Clotharmor"]`, equipped icons correct |
| 26 | Chrome: clicking an inventory item equips it via `EQUIP_ITEM` | PASS — server round-trip, no errors |
| 27 | Chrome: real loot of an in-world Sword2 updates inventory + auto-equips | PASS — inventory `[21,60,61]`, equippedWeapon `61`, no exceptions |
| 28 | Chrome: no console errors / exceptions during inventory flows | PASS |
| 29 | Fix: armor sprite on player did not change when equipping (animation stale) | PASS — `switchArmor` now clears `currentAnimation` and replays `idle`, rebuilding frames from the new sprite |
| 30 | Chrome: `onPlayerEquipItem` (real EQUIP message) changes armor sprite + weapon name | PASS — `clotharmor`→`platearmor`, `sword1`→`axe`, animation bound to new sprite, no errors |
| 31 | Server unit: HELLO accepts optional inventory array; nested/non-array handled | PASS — 16/16 persistence unit checks |
| 32 | Server unit: seeded inventory filters unknown kinds, dedupes, keeps equipped | PASS |
| 33 | Chrome: inventory persists across tab reload + re-login | PASS — session 1 `[21,60,61]` → after reload `[21,60,61]`, equipped `61`/`21` unchanged |
| 34 | Chrome: tampered/foreign inventory in localStorage is sanitized (no crash/kick) | PASS — junk `[999,2,61,"x",21]` → login with `[sword2,clotharmor,sword1]` |
| 35 | Server unit: equip/unequip broadcasts EQUIP to self (`ignoreSelf=false`) | PASS — 5/5 (armor, weapon, loot auto-equip, unequip) |
| 36 | Wire: `EQUIP_ITEM` from client → server sends EQUIP back to the same player (batched) | PASS — weapon became `65`; `[13,<id>,65]` received |
| 37 | Chrome (real server): equipping armor updates sprite immediately, no reload | PASS — `clotharmor`→`platearmor`, no exceptions |
| 38 | Chrome (real server): stored login portrait regenerates on equip | PASS — portrait image length changed, `player.armor` = `platearmor` |
| 39 | Chrome: inventory icon shows a single frame, not 6 squeezed | PASS — computed `background-size:600% 100%`; canvas clip analysis shows one icon (12 of 24 columns occupied) |
| 40 | Chrome: HP numeric readout shows `current/total` and updates | PASS — `80/80` on start, `37/80` after damage |
| 41 | Chrome: no console errors / exceptions while opening inventory & HP | PASS |
| 42 | Chrome: HP text is right-aligned on the bar | PASS — `justify-content:flex-end`, text right edge == bar right edge (431px) |
| 43 | Server unit: `canRegen()` semantics | PASS — 9/9 (spawn, >2s idle, move reset, aggro block, aggro clear, 2000ms boundary) |
| 44 | Server unit: regen tick body (player vs mob, heal amount, message) | PASS — 7/7 |
| 45 | Server unit: no heal while moving or aggroed; heals by maxHp/25 when idle & safe | PASS |
| 46 | Server unit: `DAMAGE` message carries current/max HP | PASS — 3/3 |
| 47 | Chrome: mob HP bar drawn above aggroed/damaged mob sprite | PASS — bar ~20px wide centred above sprite; hidden at full HP |
| 48 | Chrome: real `ATTACK` (mob→player) marks mob aggroed | PASS |
| 49 | Fix: small mob HP bar never rendered (`isFading` gate) — now draws | PASS |
| 50 | Server: mob spawn state + `SPAWN` message carry current/max HP | PASS — 4/4 |
| 51 | Chrome: all freshly spawned mobs have non-zero hp/max | PASS — 25/25 |
| 52 | Chrome: full target-mob HP bar (name + current/max) above player HP bar | PASS — `Rat 18/25`, above bar |
| 53 | Chrome: target bar hides when target cleared | PASS |
| 54 | Short mob bar length is uniform across sprite sizes | PASS — both 16px and 32px sprites → 48px bar (scale 2) |
| 55 | Target bar fill is red and non-zero height | PASS — fill `rgb(224,32,32)`, track height 12px, fill shrinks with HP |
| 56 | Server: weapon switch does not heal or change max HP | PASS — 11/11 equip-heal checks |
| 57 | Server: armor switch changes max only, current HP carried over/clamped, no heal | PASS |
| 58 | Chrome: damaged player switches weapon → stays damaged; switches armor → max changes, HP not refilled | PASS — `30/80` → weapon `30/80` → armor `30/110` |
| 59 | `npm run equipment:build` valid JSON | PASS — 13 items / 2 types; 3 files generated |
| 60 | Server loads equipment via loader; kinds/levels/maxHp resolve | PASS — sword1 lvl 1, platearmor maxHp 170, ranks correct |
| 61 | Chrome: client loads Equipment + sprites, game starts, no JS exceptions | PASS — types `[weapon, armor]`, HP `80/80`, sprites loaded |
| 62 | Chrome: loot sword2 → inventory + auto-equip + correct item icons | PASS — `[clotharmor,sword1,sword2]`, weapon 61, icons `item-*.png` |
| 63 | Build validation rejects missing sprite / dup id (spot check) | PASS — fails cleanly, writes nothing |
| 64 | Adding a new weapon to JSON registers it end-to-end | PASS — `warhammer` id 67, level 8, item class + builder generated |
| 65 | Renamed equipment: no duplicate `kinds` entries; asset key stable | PASS — `getKindAsString(60)` = `sword1`, alias `Dagger`→60 |
| 66 | Client installs `Types.Entities.*` for renamed items | PASS — `STEEL_SWORD`=61, `DAGGER`=60 |
| 67 | HUD inventory labels show equipment display names | PASS — `["Dagger","Steel Sword","Steel Axe","Travel Clothes"]` |
| 68 | Chest loot works with renamed equipment (no client error) | PASS — looted `sword2` items appear, no exceptions |
| 69 | Mob unit: sole-hater mob heals to full on return + fires callback | PASS — 10/10 mob-heal checks |
| 70 | Mob unit: multi-hater mob does not heal; re-aggro during return cancels heal | PASS |
| 71 | `detachPlayerFromAttackers`: sole attacker detached & mob cleared | PASS — 4/4 |
| 72 | Live server: logout of sole attacker heals damaged mob and pushes `MOB_HEALTH` | PASS — `[30, mob, 25, 25]` broadcast |
| 73 | Client: `receiveMobHealth` updates mob HP (5/25 → 25/25), no exceptions | PASS |
| 74 | Levels module: linear XP/level, stat curves, split, sanitize | PASS — manual checks (L1→L2=50, L3 stats, split) |
| 75 | Server progression unit (XP→level, Vigor→HP, allocate, over-alloc guard, HELLO sanitize, message layout) | PASS — 17/17 |
| 76 | Cooperative kill XP: split favours lower level (L3 +6, L8 +2 of 8); solo = full XP | PASS — 4/4 |
| 77 | Live protocol: PROGRESSION on login; ALLOCATE_STAT handled, no server errors | PASS |
| 78 | Chrome: HUD shows level/XP bar/stat points; allocate click persists | PASS — `Lv 1 0/50` → `Lv 3 70/150 47%`, points 2, allocated {vigor:1} |
| 79 | Chrome: progression persists across reload+re-login via HELLO validation | PASS — restored Lv3, 70/150 XP, vigor 15, maxHp 90 |
| 80 | Stats panel renders 8 rows with values/level/available points | PASS — `Level 4`, `3 points available`, Vigor=16…Arcane=13 |
| 81 | Panel opens (Stats button / level click / C) and closes (× / C / Esc) | PASS |
| 82 | `+` allocation is server-authoritative and updates stats/points live | PASS — Strength +1 → available 3→2, value 16→17, `+1` shown |
| 83 | Vigor allocation raises max HP without healing current HP | PASS — maxHp 92→94, HP `92/94` |
| 84 | Cannot over-allocate (client disables `+`; server clamps) | PASS — drained to 0 points, extra clicks blocked, `disabled` |
| 85 | Server boots / serves with panel changes; no client exceptions | PASS |
| 86 | Character panel close button closes it (single handler) | PASS — `#stats-panel .close` has 1 click handler; click → inactive |
| 87 | Outside-click still closes the panel | PASS — `hideWindows()` removes `active` |
| 88 | No regression: open/other close paths unaffected | PASS |
| 89 | `npm run npcs:build` validates data and generates `npcs-data.js` | PASS — 23 NPCs |
| 90 | Server `spawnNpcs` spawns all 23 NPCs from data at correct coords with config | PASS — 8/8 (king at 126,138) |
| 91 | Client loads NPC data; `talk()` returns configured lines, not hardcoded | PASS — sorcerer/king/agent lines from JSON |
| 92 | Client NPC display name resolves by position (king→"King", coder→"Coder") | PASS |
| 93 | Map NPC tiles no longer duplicate (NPCs only from data) | PASS — exactly 23 spawned |
| 94 | Build rejects unknown `kind` (validation) | PASS |
| 95 | Coordinate readout shows player grid x,y in top-right of the border | PASS — text matches `player.gridX/gridY` |
| 96 | Coordinate readout updates live when the player's position changes | PASS — `41,233` → `100,50` |
| 97 | No client exceptions from the coordinate display | PASS |

### Passive Regeneration — detailed test record

Harness: `regen-suite.js` (server-side; builds real `Player` instances and runs the
exact `worldserver.js` regen-tick body). Functions under test:
`Player.canRegen()`, `Character.regenHealthBy()`, `Character.regen()`,
the `onRegenTick` closure in `WorldServer`. All 17 checks passed.

| ID | Test function | Expected | Actual | Status |
|----|---------------|----------|--------|--------|
| R1 | `canRegen()` immediately after spawn | `false` | `false` | PASS |
| R2 | `canRegen()` after idle > 2s, no aggro | `true` | `true` | PASS |
| R3 | `canRegen()` right after a move (timer reset) | `false` | `false` | PASS |
| R4 | `canRegen()` with an attacker while idle > 2s | `false` | `false` | PASS |
| R5 | `canRegen()` after attacker removed | `true` | `true` | PASS |
| R6 | `canRegen()` at exactly 2000ms idle | `false` | `false` | PASS |
| R7 | `canRegen()` at 2001ms idle | `true` | `true` | PASS |
| R8 | idle+safe player heals by `floor(maxHp/25)` (hp 10→13, maxHp 80) | `13` | `13` | PASS |
| R9 | idle+safe player receives `HEALTH` regen update | `true` | `true` | PASS |
| R10 | aggroed player does not heal (base rate 0) | `10` | `10` | PASS |
| R11 | aggroed player receives no regen message | `false` | `false` | PASS |
| R12 | player that just moved does not heal | `10` | `10` | PASS |
| R13 | full-health player untouched | `80` | `80` | PASS |
| R14 | three idle ticks accumulate (hp 1→10) | `10` | `10` | PASS |
| R15 | regen never exceeds max HP | `80` | `80` | PASS |
| R16 | mobs keep original regen (unaffected by player rule) | `9` | `9` | PASS |
| R17 | heal rate equals `floor(80/25)=3` at current level | `13` | `13` | PASS |

### Mob HP bar — detailed test record

Harness: server unit + Chrome headless driving the real client handlers/renderer.

| ID | Test function | Expected | Actual | Status |
|----|---------------|----------|--------|--------|
| M1 | `Messages.Damage.serialize()` includes current HP | `msg[3]===12` | `12` | PASS |
| M2 | `Messages.Damage.serialize()` includes max HP | `msg[4]===50` | `50` | PASS |
| M3 | DAMAGE layout `[type,id,dmg,hp,maxHp]` | `[16,77,8,12,50]` | `[16,77,8,12,50]` | PASS |
| M4 | `drawMobHealthBar` geometry at 50% HP (20px track) | fill width `10` of `20`, bar above sprite | `{x:98,y:195,w:10,h:3}` fill of `w:20`, bar `y:194` above sprite `dy:200` | PASS |
| M5 | `drawEntity` draws a bar for an aggroed/damaged mob | `true` | `true` | PASS |
| M6 | `drawEntity` draws no bar when mob is full HP and not aggroed | `false` | `false` | PASS |
| M7 | Real `ATTACK` (mob→local player) sets `mob.aggroed` | `true` | `true` | PASS |
| M8 | Mob spawn state carries HP (`Mob.getState`) | `[id,kind,x,y,orientation,0,12,50]` | `[7001,2,10,20,2,0,12,50]` | PASS |
| M9 | `SPAWN` message carries hp at idx 7 / max at idx 8 | `12` / `50` | `12` / `50` | PASS |
| M10 | Real spawn gives every mob non-zero hp/max on client | `25/25` | `25/25` (all 17 rats) | PASS |
| M11 | Small bar renders for a damaged visible mob during `renderFrameDesktop` (isFading fix) | drawn | `barDrawnForTarget: true` | PASS |
| M12 | Targeted mob shows full target HP bar (visible, name, text) | `visible`, `Rat`, `18/25` | `visible`, `Rat`, `18/25`, fill `72%` | PASS |
| M13 | Target HP bar positioned above the player HP bar | bar bottom ≤ healthbar top | bar `y:602` above healthbar `y:609` | PASS |
| M14 | Target bar hides when target cleared | hidden | hidden | PASS |
| M15 | Combined live check: small bar + target bar, no real JS exceptions | both true / none | `smallBarDrawn:true`, `targetBarVisible:true`, no exceptions | PASS |
| S1 | Build tools (equipment + npcs) after data changes | OK / OK | `13 items`, `23 NPC(s)` | PASS |
| S2 | `teleportscroll` kind + storable + chest rejection (Node) | 56 / true / false | `56 / true / false` | PASS |
| S3 | Sell prices (sword1=5, scroll=15, flask=3) | `5/15/3` | `5/15/3` | PASS |
| S4 | `Messages.Inventory` serialization (equipment/counts/gold) | `[27,[60,21],60,21,{"35":1,"56":2},40]` | same | PASS |
| S5 | Server unit suite (loadout, dup routing, buy/sell, sanitize, legacy) | 24/24 | 24 passed, 0 failed | PASS |
| S6 | Real WS bot: HELLO with gold 100 + 2 scrolls echoed | gold 100 / scrolls 2 | `100 / 2` | PASS |
| S7 | WS buy scroll near Village Girl (25g) | gold 75 / scrolls 3 | `75 / 3` | PASS |
| S8 | WS sell scroll (15g) | gold 90 / scrolls 2 | `90 / 2` | PASS |
| S9 | WS buy/sell away from shop rejected (gold unchanged, "no shop" notice) | gold 90 / notice | `90` / notice found | PASS |
| S10 | CDP: talk to Village Girl opens shop HUD, buy row 25g, disabled at 0 gold | active / 1 / disabled | `active / 1 / disabled` | PASS |
| S11 | CDP reload persistence: gold 42, scroll x3, flask x2, steel sword owned, panel sections + x3 render | all true | all true | PASS |
| S12 | `regen-suite.js` unaffected by inventory refactor | 17/17 | 17 passed, 0 failed | PASS |
| W1 | `Types.isUsableItem`/`warpDestinations`/display name (Node) | true / 16,223 / `[★ Initial Town]` | same | PASS |
| W2 | Server `useItem` unit: WARP[36,16,223], scroll consumed, notice sent | pos 16,223, left 1 | `[[36,16,223],[27,...],[11,...]]` | PASS |
| W3 | Real WS bot: USE scroll warps to (16,223) + consumes 1 | warp 16,223 / count 0 | `[16,223]` / `0` | PASS |
| W4 | WS bot: use with none left / non-usable item → no WARP | no new warp | no new warp | PASS |
| W5 | CDP: clicking Village Girl shows dialogue but does NOT open shop | dialogue / shop closed | `true / false` | PASS |
| W6 | CDP: clickable "Trade" option bubble appears (pointer-events auto) | shown / auto | `true / "auto"` | PASS |
| W7 | CDP: clicking option bubble opens shop; buy row named `[★ Initial Town]` | opens / named | `true / true` | PASS |
| W8 | CDP: `useItem` warps local player to 16,223 and scroll count → 0 | 16,223 / 0 | `16,223 / 0` | PASS |
| W9 | CDP: Priest (no shop) shows no option bubble; talking twice cycles lines, shop stays closed | no-opt / differ / closed | `no-opt / differ / closed` | PASS |
| W10 | Shop WS bot (buy) still works after message changes | gold 75 / count 3 | `75 / 3` | PASS |
| D1 | `Formulas.dmg` always returns an integer (20k float rolls) | 0 non-int | 0 non-int | PASS |
| D2 | HP stays integral after 1000 hits; regen-suite unaffected | int / 17/17 | int / 17 passed | PASS |
| MM1 | Minimap terrain built (3px/tile supersampled) from real tileset | built / 516×942 | `516×942` | PASS |
| MM2 | Terrain has real colour variety (not blank) | true | true | PASS |
| MM3 | Default zoom canvas 125×125; draw no-throw, no JS exceptions | 125×125 / none | same | PASS |
| MM4 | Toggle to fixed: 125 wide × ~422 tall (overworld crop); label flips to "Local" | fixed / 125 / 422 | same | PASS |
| MM5 | Dots: blue player + green NPC/players + red mobs present in zoom | blue>0, green>0, red>0 | `30 / … / 66` | PASS |
| MM6 | Fixed overworld view shows blue/green/red dots | blue>0 | `46 / 4806 / 72` | PASS |
| MM7 | Coordinates positioned visually below the minimap | true | true | PASS |
| MM8 | Regression: minimap showed as a 1px line in-game — global `canvas{position:absolute}` made `#minimap-canvas` absolute, collapsing `#minimap` height. Fix: `#minimap-canvas{position:static}`. | not collapsed | fixed | PASS |
| MM9 | `applySize` hardened against NaN/0 (fixed mode before map ready) and terrain-not-ready no longer collapses | no collapse | no collapse | PASS |
| MM10 | Fixed world view crops to overworld (x<93); dungeon rooms excluded; `overworldW=93` | 93 | `93` | PASS |
| MM11 | Look cleaned up: terrain drawn at 3px/tile and downscaled (smooth) instead of 1px/tile | supersampled | `516×942 terrain` | PASS |
| MM12 | Zoom view closer: `zoomTiles` 70 -> 36 (smaller local window) | 36 | `36` | PASS |
| MM13 | All dots (blue player / green players+NPCs / red mobs) share the player's radius 3.2 | unified | `radius = 3.2` for all | PASS |
| MM14 | Clickable toggle button + `M` key cycle zoom -> fixed -> hidden -> zoom | 3 states | `zoom/fixed/hidden` | PASS |
| MM15 | Hidden mode hides the map canvas but keeps the toggle button clickable; labels World/Hide/Local | works | `hidden canvas, visible button` | PASS |
| ED1 | `/editor` serves editor shell + JS + CSS (200) when `editor_enabled` | 200 | 200 | PASS |
| ED2 | `GET /editor/api/load` returns clientMap + serverMap + npcs | all present | all present | PASS |
| ED3 | Editor loads in browser: palette 640px + map canvas ~1074px, 704k painted px, no JS exceptions | renders | same | PASS |
| ED4 | Palette pick -> paint cell -> Save changes `data[0]` (1378 -> 6) and writes both maps + regenerates `world_client.js` | writes | both written | PASS |
| ED5 | Save API writes JSON + `world_client.js` (`var mapData = ...`) and restores cleanly; no stray backups | ok | ok | PASS |
| ED6 | Toolbar: Save status capped/ellipsised, coordinate readout stays visible (no wrap off-screen) | visible | `info visible` | PASS |
| ED7 | Editor loads with all phase tools + Types global; inspector + import dialog; no JS exceptions | ok | ok | PASS |
| ED8 | NPC tool: click places NPC, inspector edits, `Apply NPCs` writes npcs.json (23 -> 24), restored | writes | restored 23 | PASS |
| ED9 | Region tools save: musicAreas+1, checkpoints+1 (client+server), roamingAreas+1, chestAreas+1 | all +1 | all +1 | PASS |
| ED10 | Door point writes to client+server doors (+1 each) | +1/+1 | 85/85 | PASS |
| ED11 | Asset import writes PNG to allow-listed path; traversal (`../../`) rejected 400 | ok/400 | ok/400 | PASS |
| ED12 | Select/move: clicking a placed static entity shows its `Kind` (was empty) and selects `staticEntities` despite overlapping regions | populated | `rat` | PASS |
| ED13 | Select/move priority: points (NPC/door/chest/static entity) chosen before enclosing regions; empty tile inside a region still selects the region | correct | `Edit staticEntities` vs `Edit musicAreas` | PASS |
| ED14 | `GET /editor/api/sprites` lists 73 sprites incl. `test-missing` with all scales present | 73 / all | all true | PASS |
| ED15 | Editor sprite palette renders thumbnails; `test-missing` present with `/img/` thumbnail; name filter narrows to 1 | ok | ok | PASS |
| ED16 | Tile filter: tile-id range + 'only used in map' apply without errors | ok | ok | PASS |
| ED17 | Static-entity/NPC Kind is a sprite `<select>`; selecting a sprite sets the kind | test-missing | `test-missing` | PASS |
| ED18 | `POST /editor/api/import-sprite` writes JSON+PNG and regenerates `sprites.generated.js` (cleaned up after) | writes | all written | PASS |
| ED19 | Auto-generate missing scales in-browser: 32px -> 16x16 (scale1) and 48x48 (scale3) | 16x16 / 48x48 | PASS | PASS |
| ED20 | Import dialog has 3 scale inputs + terrain-tile toggle | present | present | PASS |
| ED21 | Left palette is two tabs (Tiles/Sprites): Tiles active by default, Sprites hidden; clicking Sprites shows the grid, hides tiles; switch back works | ok | ok | PASS |
| ED22 | Fix `Import error: have is not defined`: hoist `have`/`pngs` into doImport scope; import with only a scale-2 PNG now succeeds and auto-generates scales 1 & 3 | success | `Imported __fixtest` (1,2,3 written) | PASS |
| ED23 | Terrain import: composite test-missing2 -> appended as tile #1922; wrote all 3 tilesheets + tiles.json (name) | #1922 | `test-missing2` | PASS |
| ED24 | Name filter hides non-matching tiles (only #1922 visible); new tile art present at cell (1,96) | 1 shown | `248,5,233` art | PASS |
| ED25 | Tilesheet integrity after re-encode: scale2 640x3136, tile1 still has content, tile #1922 opaque | ok | `tile1 752 / 1922 1024` | PASS |
| ED26 | Selecting a tile shows its name in the status bar (from tiles.json registry) | shows | `test-missing2` | PASS |
| ED27 | BUG: terrain import used `max data id + 1` = 1922, but 1921-1935 are a wave animation (`animated[1921].l=15`) -> overwrote wave frame 1922. Fix `nextTileId` to include animated frame spans | fixed | max=1935 -> next 1936 | PASS |
| ED28 | Repaired overwritten wave frame 1922 (copied adjacent wave 1923) in all 3 sheets; re-imported test-missing2 at safe id #1936; waves 1921/1935 blue, 1936 = test art | ok | `1921/1935=82,144,184` / `1936=128,1,119` | PASS |

## Known notes / non-blocking observations

- **Minimap**: terrain is built once (one `drawImage` per tile into a 3px/tile
  offscreen canvas, ~54k calls) at map load; per-frame cost is a single scaled
  `drawImage` + a few dots, negligible. It samples the renderer's *active*
  tileset which is **scale-dependent** (e.g. `img/2` at scale 2); if the renderer
  rescales, rebuild via `game.initMinimap()`. Modes cycle zoom -> fixed -> hidden
  (via the `M` key or the clickable "World/Hide/Local" button). Zoom = 125x125
  (~36-tile local window); fixed = whole **overworld** at 125px wide (~422px tall),
  cropping the dungeon rooms (renders x < 93 only; `OVERWORLD_W` constant in
  `minimap.js` for this
  single shipped map — adjust if the map changes).
- **Minimap 1px-line regression (fixed)**: the global `canvas { position:absolute; }`
  rule (intended for the game canvases) also applied to `#minimap-canvas`, taking
  it out of flow so `#minimap` collapsed to a thin bordered line. `#minimap-canvas`
  is now `position:static`, and `Minimap.applySize`/`draw` guard against NaN/0
  sizing (e.g. fixed mode toggled before terrain is ready).

- **Shop/teleport (new)**: the `teleportscroll` icon currently reuses the flask
  spritesheet as a placeholder (`client/img/{1,2,3}/item-teleportscroll.png`);
  replace with real art later. The warp item is now **usable** (click it in the
  inventory to consume one and warp to Initial Town 16,223). `sellPrice` defaults
  to `rank*5` for gear that has no explicit `sellPrice` in `equipment.json`.
- **NPC conversation flow**: talking to an NPC only cycles its dialogue. Shops
  (and future NPC events) are triggered by clicking the separate "Trade" option
  bubble. The bundled jQuery is 1.6.4 (no `.on()`); use `.bind()`/`.click()`.
- `npm audit` reports 2 vulnerabilities (1 high, 1 critical) in the dependency tree
  from old packages (`sanitizer`, `log`, etc.). Not fixed to avoid changing game
  behavior; flagged for awareness.
- Production build (`bin/build.sh`, RequireJS optimizer) is a bash script and was
  **not** tested; it requires a Unix-like shell (Git Bash/WSL) on Windows. Dev mode
  is fully working.
- The server logs `"No level found for armor/weapon: undefined"` only when a malformed
  HELLO is sent with equipment id `0` (seen in low-level probe). The real client
  sends valid equipment ids, so this does not occur in normal play.
- Inventory/equipment is deliberately "barebone": single weapon slot + single armor
  slot, auto-equip-if-better on pickup, manual equip from the panel. There is no
  item drop/sell, stacking, or drag-and-drop. `unequipSlot` is implemented
  server-side but not wired to a UI button (barebone HUD only lists/equips).
- Visual equipment bug (fixed): equipping armor changed stats/icon but the player
  sprite stayed the same. `entity.setAnimation()` early-returns when the animation
  *name* is unchanged (`idle_down`), so after `setSprite()` the old animation object
  (with stale frame data from the previous sprite sheet) kept rendering. Fix:
  `Player.switchArmor` nulls `currentAnimation` and calls `idle()` after `setSprite`,
  and `onPlayerEquipItem` now routes armor through `switchArmor` (which also keeps
  `spriteName` in sync). Weapons are drawn separately by the renderer from
  `weaponName`, so they were already updating once the name was set.
- Inventory persistence (fixed): the client previously saved only equipped
  armor/weapon names, not the inventory, so on re-login the server seeded the
  inventory from just those two and everything else was lost. The full inventory
  is now stored in `localStorage` (`player.inventory`), sent as an optional 4th
  HELLO field, and sanitized by the server (`buildInventoryFromHello`). Tampered
  or stale kinds are dropped rather than kicking the player.
- Immediate visual update (fixed): `Player.broadcast()` skips the sender by
  default, so a player equipping gear did not receive their own `EQUIP` message
  and their sprite only refreshed after re-login. Equip changes now use
  `broadcastEquip()` (which includes the sender). The load-character portrait is
  no longer stale because `savePlayerPortrait()` regenerates it on equip.
- Mob HP bar: shown only for mobs that are attacking (aggro) or damaged. Mob HP is
  now sent on spawn (`Mob.getState`), so the bar has real values immediately; it
  updates from `DAMAGE` messages and hides when the mob is at full HP and not
  attacking. Drawn on the entities canvas in screen space so it follows the mob
  and camera. (Fixed earlier bug: the `isFading` gate suppressed it because desktop
  entities set `isFading=true` on spawn and never clear it.)
- Targeted-mob HP bar: drives off the player's existing single `player.target`
  (set when the player attacks); no multi-target selection was needed. It shows
  the mob name and `current/max` just above the player HP bar. If multi-target
  selection is added later, point `Game.refreshTargetBar()` at the primary target.
- Equip healing (fixed): gear changes used to call `updateHitPoints()` (a full
  `resetHitPoints`), and the client's max-HP handler refilled current HP — giving
  a free heal on every equip. Now armor changes use `updateMaxHitPoints()` (max
  changes, current HP carried over/clamped) and the client only updates max HP;
  weapon changes never touch HP. Spawn and the firepotion still set full HP.
- Equipment is now data-driven: edit `shared/data/equipment.json`, then run
  `npm run equipment:build` (auto-run on `npm start`). Adding items to the
  existing `weapon`/`armor` categories works fully end-to-end. Adding a brand-new
  *category* (e.g. `deco`, `ring`) registers the items and shows them in the
  inventory list, but equipping them requires code changes to the equip/slot
  logic and HUD (the data/build side already supports arbitrary categories). See
  `tools/equipment/README.md`.
- Equipment `name` is the **display name** (free-form, e.g. `Steel_Sword`); the
  **sprite/asset keys** are `sprite`/`itemSprite`. Rename items freely without
  touching art by keeping `sprite`/`itemSprite` pointed at existing sprites. The
  engine keeps the legacy asset name as the canonical kind name (used for sprite
  lookups) and treats the display name as an alias, so renaming does not break
  sprites, hurt-sprite generation, chest drops, or inventory icons.
- Mob healing on vanish: when a mob's **only** attacker dies, logs out, or
  teleports away, the mob returns to its spawn point and heals to full **on
  arrival** (a re-aggro during the walk-back cancels the heal). If the mob still
  has other attackers it stays damaged and keeps fighting them. Zone/room changes
  within the open world do **not** trigger healing (the whole world is treated as
  one room). Nearby clients are updated via the `MOB_HEALTH` state message.
- XP/levels: linear curves, cap 255; all eight stats start at 10 and grow
  linearly (Vigor/Strength faster) plus 1 allocatable point per level. Vigor and
  Strength affect max HP and attack power; other stats are stored/displayed only.
  Cooperative kills split XP across every contributor (hatelist) treated as one
  party — higher-level players get a larger discount, lower-level players a
  larger share. Progression persists in `localStorage` and is validated
  (clamped) by the server on HELLO. Points are spent through the **Character
  panel** (Stats button / click level / `C`), which lists every stat with its
  total, allocated `+N`, and a `+` button; allocation is server-authoritative and
  `+` is disabled when no points remain. Only Vigor (max HP) and Strength (attack
  power) affect gameplay so far.
- NPCs are data-driven (`shared/data/npcs.json`, edit + `npm run npcs:build`).
  Each entry defines id, displayed name, sprite kind, world coordinates,
  conversations, and an `events` list reserved for future interactions (e.g. a
  shop). NPCs are spawned server-side from this data (map NPC tiles are ignored)
  and the client matches them by position for their name and dialogue. No event
  types are implemented yet.

## Files changed

- `package.json` — deps pinned, ws added, scripts added
- `package-lock.json` — regenerated
- `server/js/ws.js` — rewritten on `ws`; now also serves the client + `/shared/*`
- `server/js/static.js` — new: safe static file server (MIME + traversal guard)
- `server/js/map.js` — `fs.existsSync` fix
- `server/js/worldserver.js` — regen tick: players heal only when `canRegen()`;
  `detachPlayerFromAttackers` (death/teleport/logout); `addMob` wires mob
  `onHealthChange` → broadcast `MOB_HEALTH`; `awardKillXP` (cooperative split);
  `spawnNpcs()` spawns NPCs from data; map NPC tiles skipped
- `shared/data/npcs.json`, `shared/data/npcs.schema.json` — new: NPC data
- `shared/js/npcs.js` — new: NPC loader (Node + browser)
- `shared/js/npcs-data.js` — generated (inline NPC data)
- `tools/npcs/build.js`, `tools/npcs/README.md` — new: NPC build + docs
- `client/js/npc.js` — data-driven `talk()`/`getDisplayName()`/`getEvents()`
- `client/js/npcs.js` — reads `idleSpeed` from data
- `client/js/renderer.js` — draws NPC display names
- `package.json` — `npcs:build` script; `prestart` runs both builds
- `tools/README.md` — lists the NPC build tool
- `shared/js/levels.js` — new: XP/level/stat curves, split, validation
- `server/js/properties.js` — per-mob base `xp`
- `server/js/formulas.js` — `dmg(attackPower, armorLevel)`
- `server/js/player.js` — progression state, `gainXP`, `allocateStatPoint`,
  Vigor→maxHP, Strength→attack power
- `client/js/game.js` — progression state/callbacks, allocation, persistence
- `client/js/app.js` — `updateProgression` HUD (level text + XP bar + points);
  stat-allocation panel (`updateStatsPanel`, `toggleStats`, stat labels)
- `client/js/main.js` — Stats button / level-click / `C` key open the panel;
  close via shared `$('.close')` → `hideWindows()` (removed the duplicate
  double-toggling stats-close handler); `onProgressionChange`
- `client/index.html` — `#level-display` overlay + `#stats-panel` (Character) +
  `#coords-display`
- `client/css/main.css` — level/XP display, character/stats panel, coordinate
  readout styles
- `client/js/game.js` — `updateCoordsDisplay()` (top-right coordinate readout)
- `server/js/player.js` — inventory state, `addToInventory`, `equipFromInventory`,
  `unequipSlot`, `sendInventory`, `buildInventoryFromHello`, `broadcastEquip`
  (includes self), `isArmorOrWeaponKind` guard; LOOT branch adds to inventory;
  `lastMoveTime` + `canRegen()` (out-of-combat idle regeneration);
  `updateMaxHitPoints()` (armor changes alter max only, no heal)
- `server/js/message.js` — `Messages.Inventory`; `Messages.Damage` now carries
  `currentHitPoints` / `maxHitPoints`; `Messages.MobHealth` (`MOB_HEALTH`)
- `server/js/format.js` — validation for `EQUIP_ITEM` / `UNEQUIP`; lenient
  `checkHello` accepting an optional inventory array
- `shared/js/gametypes.js` — message types 27/28/29/30 (`MOB_HEALTH`)
- `client/js/config.js` — optional build config
- `client/js/storage.js` — `player.inventory` + `setPlayerInventory` /
  `getPlayerInventory`
- `client/js/gameclient.js` — INVENTORY handler, `sendEquipItem`/`sendUnequip`,
  `sendHello(player, inventory)`; `receiveDamage` forwards mob HP;
  `receiveMobHealth` + `onMobHealthChange`
- `client/js/renderer.js` — imports `mob`; `drawMobHealthBar()` + call in
  `drawEntity` for aggroed/damaged mobs (no `isFading` gate)
- `client/js/game.js` — inventory state + accessors + `window.game` debug hook;
  persists inventory on `onInventory`; `sendHello` sends persisted inventory;
  `onPlayerEquipItem` uses `switchArmor` for armor, refreshes weapon animation,
  and regenerates the stored portrait for the local player via
  `savePlayerPortrait`; stores mob HP on damage and marks `aggroed` on mob attack;
  `refreshTargetBar()` drives the targeted-mob HP bar from `player.target`;
  `onPlayerChangeMaxHitPoints` updates max only (clamps current, no refill)
- `client/js/player.js` — loot no longer rejects duplicate/weaker items;
  `switchArmor` force-rebuilds the animation so the new sprite renders
- `client/js/item.js` — optimistic equip only when better
- `client/js/app.js` — `updateInventory`, `toggleInventory`, icon helpers; HP
  text updated in `initHealthBar` health callback; `updateTargetBar(mob)`
- `client/js/main.js` — inventory panel events, `I` key, `onInventoryChange`
- `client/index.html` — inventory panel markup; weapon/armor icons clickable;
  `#hp-text` numeric HP readout inside `#healthbar`; `#target-bar` element
- `client/css/main.css` — inventory panel styles; item icons show one frame
  (`background-size:600% 100%`); `#hp-text` overlay styling (right-aligned);
  `#target-bar` styling + per-breakpoint geometry
- `server/js/mob.js` — `getState()` appends orientation/target/hitPoints/maxHitPoints;
  `returnToSpawningPosition(wait, healOnArrival)` heals to full on arrival when
  the last hater is gone (cancelled by re-aggro); `onHealthChange`
- `client/config/config_local.json`, `client/config/config_build.json` — new
- `server/config_local.json` — new
- `shared/data/equipment.json` — new: equipment source of truth
- `shared/data/equipment.schema.json` — new: JSON schema for the editor
- `shared/js/equipment.js` — new: equipment loader (Node + browser)
- `shared/js/gametypes.js` — `registerKind` (aliases for duplicate names,
  no duplicate `kinds`), `findKindNameById`, `getTypeOf`, tolerant `getType`
- `shared/js/equipment.js` — lazy `Types` resolution; `load()` always re-installs
  into the current `Types` (fixes browser load-order)
- `server/js/properties.js` — levels/max HP from loader; `getMaxHitPoints`
- `server/js/player.js` — max HP via `Properties.getMaxHitPoints`
- `client/js/game.js` — sprite list from loader; `equipment` dependency
- `client/js/item.js` — loader sprite names / loot text / rank comparisons
- `client/js/items.js` — merges generated equipment classes + consumables
- `client/js/sprites.js` — re-exports generated sprite manifest
- `client/js/entityfactory.js` — `equipment` dependency; robust builder kind
  resolution from `Items._builders`
- `client/js/app.js` — equipment-aware inventory listing, display names, icons
- `tools/equipment/build.js` — new: validate + generate equipment files
- `tools/equipment/README.md` — new: equipment editor documentation
- `shared/js/equipment-data.js` — generated (browser inline data)
- `client/js/items.generated.js` — generated (item classes + builders)
- `client/js/sprites.generated.js` — generated (sprite manifest)
- `package.json` — added `equipment:build` and `prestart` scripts
- `README.md`, `server/README.md`, `client/README.md` — updated
