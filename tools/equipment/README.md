# Equipment Editor

BrowserQuest's weapons, armors, and any future equipment types are defined in a
single data file:

```
shared/data/equipment.json
```

Edit that file, then run the build step to validate it and regenerate the
derived files. You do **not** need to edit any JavaScript to add or change
equipment.

```
npm run equipment:build
```

(`npm start` also runs the build automatically via a `prestart` hook, so a
forgotten build won't leave stale data on the server.)

---

## 1. File layout

```json
{
    "version": 1,
    "types": { "weapon": {...}, "armor": {...} },
    "weapons": [ { ...weapon... }, ... ],
    "armors":  [ { ...armor...  }, ... ]
}
```

- `types` declares the equipment *categories*. Each key `foo` corresponds to an
  array named `foos` holding the items of that category. Two categories exist
  today: `weapon` and `armor`.
- `weapons` and `armors` are the item arrays.
- New categories (for example `deco` or `ring`) are added by declaring them in
  `types` and adding the matching array (`decos`, `rings`). See section 7.

---

## 2. Item fields

Every item (weapon, armor, or future type) supports:

| Field | Required | Type | Meaning |
|-------|----------|------|---------|
| `id` | yes | number | Unique entity kind id. Must not collide with any other entity id (see section 4). |
| `name` | yes | string | Unique identifier **and display name**, e.g. `sword2` or `Steel_Sword`. Shown in the HUD (underscores/camelCase are turned into spaces). Also derives the enum constant (`STEEL_SWORD`). **This is not the sprite key** — see `sprite`/`itemSprite`. |
| `type` | no | string | Category name (`weapon`, `armor`, ...). Defaults to the array it lives in. If set, it **must** match that array. |
| `subtype` | no | string | Free-form sub-category for your own organization (e.g. `sword`, `axe`, `club`). Not used by logic. |
| `rank` | yes | number | Power ordering. Higher = stronger. Used for "is this better?" comparisons and inventory sorting. Must be unique within a category. |
| `level` | no | number | Combat level fed into the damage formula. Defaults to `rank`. For weapons this drives damage; for armor it is informational (HP uses `maxHp`). |
| `maxHp` | armor only | number | Maximum hit points granted while equipped. For weapons it is ignored. |
| `sprite` | no | string | Sprite JSON name for the in-world/equipped look (e.g. `sword2`). Defaults to `name`. |
| `itemSprite` | no | string | Sprite JSON name for the ground/drop icon (e.g. `item-sword2`). Defaults to `item-<name>`. |
| `lootMessage` | no | string | Message shown when picked up. Defaults to `You pick up a <name>`. |

### Weapon example

```json
{
    "id": 61,
    "name": "sword2",
    "type": "weapon",
    "subtype": "sword",
    "rank": 2,
    "level": 2,
    "sprite": "sword2",
    "itemSprite": "item-sword2",
    "lootMessage": "You pick up a steel sword"
}
```

### Armor example

```json
{
    "id": 24,
    "name": "platearmor",
    "type": "armor",
    "subtype": "plate",
    "rank": 4,
    "level": 4,
    "maxHp": 170,
    "sprite": "platearmor",
    "itemSprite": "item-platearmor",
    "lootMessage": "You equip a plate armor"
}
```

> **Display name vs. sprite key.** `name` is free-form and is what players see
> (e.g. `"Steel_Sword"` shows as "Steel Sword"). The **sprite/asset keys** are
> `sprite` (equipped look) and `itemSprite` (drop icon); they must match files in
> `client/sprites/`. You can rename items freely without touching sprites by
> keeping `sprite`/`itemSprite` pointed at existing art. Existing items reuse the
> original art (`sword2`, `item-sword2`, ...), so renaming them only changes the
> displayed name.

---

## 3. Creating a new weapon or armor

**Weapon (step by step)**

1. Pick an unused `id` (section 4).
2. Choose a unique lowercase `name`, e.g. `warhammer`.
3. Decide `rank` (where it sits in the power order — higher than weaker items,
   lower than stronger ones; keep ranks unique in the category).
4. Set `level` (damage strength). A reasonable default is the `rank`.
5. Set `sprite` to an existing character-sized weapon sprite JSON name if you are
   reusing art, or add a new one (section 5).
6. Set `itemSprite` to the ground icon sprite, or let it default to
   `item-<name>` (section 5).
7. Add the object to the `weapons` array.
8. Run `npm run equipment:build`.
9. Start the server (`npm start`) and confirm the build output shows the new item
   count.

**Armor (step by step)**

Same as above, but:
- Add to the `armors` array.
- Set `maxHp` to the maximum HP the armor grants. For reference, the shipped
  armors use: cloth 80, leather 110, mail 140, plate 170, ruby 200, golden 230.

The new item is automatically:
- registered as an entity kind,
- included in ranking/comparison logic,
- given a client item class and EntityFactory builder,
- added to the sprite loader,
- available for mob drops and chest contents (reference it by `name`), and
- equippable through the existing inventory UI.

---

## 4. ID rules and auto-assign

`id` values share one global namespace with every entity (mobs, NPCs, items).
Ranges already used:

| Range | Usage |
|-------|-------|
| 1 | Warrior (player) |
| 2–14 | Mobs |
| 20–26 | Armors (this file) |
| 35–39 | Objects (flask, burger, chest, firepotion, cake) |
| 40–55 | NPCs |
| 60–66 | Weapons (this file) |

Pick ids that are unused. A safe convention for new equipment is to continue the
category's range (e.g. weapons 67+, armors 27–34) or use a high range such as
1000+. The build fails on duplicate ids or names.

> Note: ids are currently required. If you'd rather have the build auto-assign
> the next free id when `id` is omitted, that can be added later.

---

## 5. Sprites

Each equipment item references up to two sprite JSON files in
`client/sprites/`. The build **fails** if a referenced sprite file is missing.

- `sprite` — the equipped/in-world appearance. For weapons this is the weapon
  overlay sprite; for armors it is the full character (walk/attack/idle) sprite.
- `itemSprite` — the small ground/drop icon (a horizontal strip of frames; the
  game shows frame 0).

To reuse existing art, point both fields at existing sprite names (e.g. a new
axe variant can use `"sprite": "axe", "itemSprite": "item-axe"`).

To add new art, create `client/sprites/<name>.json` (plus the matching PNGs in
`client/img/1`, `client/img/2`, `client/img/3` at the three render scales). The
sprite manifest is regenerated automatically by `npm run equipment:build`, so new
sprite JSON files are picked up without editing `sprites.js`.

---

## 6. Editing existing values

Values that are safe to edit freely:

- `rank` (changes power ordering everywhere),
- `level` (changes weapon damage / attack formula input),
- `maxHp` (armor hit points),
- `lootMessage`, `subtype`,
- `sprite` / `itemSprite` (re-point to different art).

Avoid changing an existing item's `id` or `name`: save data (localStorage
inventories) and any map chest/drop references use the numeric id/name. Keep both
stable to preserve compatibility.

After editing, run `npm run equipment:build` and restart the server.

---

## 7. Adding a new equipment *category* (e.g. deco, ring)

The loader is category-agnostic. To add a new category:

1. Declare it in `types`, e.g.:

   ```json
   "types": {
       "weapon": { "stat": "level", "maxHpFromLevel": false },
       "armor":  { "stat": "level", "maxHpFromLevel": true },
       "ring":   { "stat": "level", "maxHpFromLevel": false }
   }
   ```

2. Add a matching array with items, e.g. `"rings": [ { ... } ]`, using the same
   item fields (set `"type": "ring"` or omit it to default to the category).

3. Run `npm run equipment:build`.

This registers the new kinds, generates item classes/builders, and adds them to
the sprite loader and inventory list. **Important:** the equipment *slots* and
equip logic currently only cover `weapon` and `armor`. Items of a brand-new
category will appear in the inventory list and be lootable, but equipping them
requires extending the server's equip/slot handling and the HUD (this is a code
change, not a data change).

---

## 8. How the loader works (for maintainers)

- **Source of truth:** `shared/data/equipment.json`.
- **Loader:** `shared/js/equipment.js` normalizes the data into a registry and
  registers kinds into `shared/js/gametypes.js` (`Types.registerKind`), builds
  `Types.rankedWeapons` / `Types.rankedArmors`, and exposes lookups:
  `getItem`, `getLevel`, `getRank`, `getMaxHitPoints`, `getLootMessage`,
  `getSpriteName`, `getItemSpriteName`, `getTypes`, `getTypeItems`.
- **Server:** `server/js/properties.js` reads equipment levels/max HP from the
  loader (`getArmorLevel`, `getWeaponLevel`, `getMaxHitPoints`).
- **Client:** `client/js/game.js` derives the sprite list from the loader;
  `client/js/item.js` uses loader sprite names / loot text; `client/js/app.js`
  uses loader item-sprite names and lists inventory items by category.
- **Generated files** (do not edit by hand):
  - `shared/js/equipment-data.js` — inline data for the browser client.
  - `client/js/items.generated.js` — item classes + builder metadata.
  - `client/js/sprites.generated.js` — sprite manifest.
- **Build tool:** `tools/equipment/build.js` validates the JSON, checks sprite
  files exist, and writes the three generated files. It exits non-zero on error.

---

## 9. Validation and errors

`npm run equipment:build` reports:

- **ERROR** (build fails, nothing written):
  - missing/invalid `types` object or a declared category with no array,
  - non-numeric `id`/`rank`, missing `name`,
  - `type` that doesn't match its array,
  - duplicate `id` or `name`,
  - missing sprite JSON for `sprite`/`itemSprite`.
- **WARN** (build succeeds):
  - duplicate `rank` within a category (ambiguous ordering),
  - an armor without `maxHp`.

Fix all errors, re-run the build, and check the output line
`Equipment build OK: N items across M type(s).`
