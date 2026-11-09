# NPC Editor

NPCs are defined in a single data file:

```
shared/data/npcs.json
```

Edit that file, then run the build step to validate it and regenerate the inline
browser data. You don't need to touch code to add, move, rename, or re-dialogue
NPCs.

```
npm run npcs:build
```

(`npm start` also runs it automatically via the `prestart` hook, together with the
equipment build.)

---

## 1. File layout

```json
{
    "version": 1,
    "npcs": [
        {
            "id": "king",
            "name": "King",
            "kind": "king",
            "x": 126,
            "y": 138,
            "conversations": ["Hi, I'm the King", "I run this place"],
            "events": []
        }
    ]
}
```

## 2. Item fields

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Unique lowercase id (`a-z0-9_`). Stable key for the NPC. |
| `name` | yes | Displayed name shown above the NPC. |
| `kind` | yes | Sprite/entity kind (e.g. `guard`, `king`, `sorcerer`). Must be a known NPC kind (see below). |
| `x`, `y` | yes | Grid coordinates in the world map (tile units). |
| `conversations` | yes | Array of strings shown one line at a time when the player talks; loops back to the start. |
| `events` | yes | Array of objects, each with a string `type` (e.g. `{ "type": "shop" }`). Currently no event types are implemented — this is where the future shop (and other interactions) will be wired. Kept as an empty array for now. |
| `idleSpeed` | no | Optional animation speed hint (e.g. `nyan` = 50, `sorcerer` = 150). |

### Known `kind` values

These come from `shared/js/gametypes.js`:

`guard, king, octocat, villagegirl, villager, priest, scientist, agent, rick,
nyan, sorcerer, beachnpc, forestnpc, desertnpc, lavanpc, coder`

Using an unknown `kind` fails the build.

## 3. Adding / editing an NPC

1. Add (or edit) an object in `npcs`.
2. Pick coordinates `x`/`y` on walkable ground near where players can reach.
3. Choose a `kind` for its appearance and set `name` (may differ from kind).
4. Fill `conversations` with the lines you want; keep `events` as `[]` for now.
5. Run `npm run npcs:build`, then restart the server (`npm start`).

## 4. How it works

- The server (`server/js/worldserver.js` → `spawnNpcs`) spawns NPCs from
  `shared/data/npcs.json` instead of the map's `staticEntities` (NPC tiles in the
  map are now ignored).
- The client loads the same data (`shared/js/npcs.js`) and matches each NPC by
  its grid position (`getAt(x,y)`), falling back to `kind`. It uses the data for
  the displayed **name** and for the lines returned by `talk()`.
- Generated browser data: `shared/js/npcs-data.js` (do not edit by hand).

## 5. Events (future)

`events` is reserved for interactions like shops. Example of what a future entry
might look like (not implemented yet):

```json
"events": [
    { "type": "shop", "items": ["sword2", "leatherarmor"] }
]
```

The client already exposes each NPC's events via `npc.getEvents()`, ready for the
shop/UI to consume later.

## 6. Validation

`npm run npcs:build` reports:

- **ERROR** (build fails, nothing written): missing `npcs` array; invalid/missing
  `id`, `name`, `kind`, `x`, `y`; unknown `kind`; non-string conversation lines;
  events without a string `type`; duplicate ids.
- **WARN** (build succeeds): two NPCs at the same position.

Fix all errors, re-run the build, and confirm:
`NPC build OK: N NPC(s).`
