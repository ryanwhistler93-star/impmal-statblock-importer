# Imperium Maledictum: NPC Stat Block Importer

Paste an NPC stat block into Foundry VTT and get a finished **Warhammer 40,000: Imperium Maledictum** NPC actor.

Built for Foundry VTT v14 and the `impmal` system (works on v13 too).

## Install

In Foundry's setup screen, go to **Add-on Modules → Install Module**, paste this into **Manifest URL** and click **Install**:

```
https://github.com/ryanwhistler93-star/impmal-statblock-importer/releases/latest/download/module.json
```

Or install by hand:

1. Download `module.zip` from the latest release and unzip into your Foundry data folder so you have `Data/modules/impmal-statblock-importer/module.json`.
2. Restart Foundry, open your Imperium Maledictum world, and enable the module under **Manage Modules**.

## Use

1. In the **Actors** sidebar, click **Import Stat Block**.
2. Paste the stat block. Text copied from a Word table, a Google Doc, a PDF or plain text all work.
3. Click **Preview** to check what will be created and any warnings, then **Create NPC**.

To import several NPCs at once, separate them with a line containing just `---`.

### Expected layout

```
Ethereal
Medium T'au (T'au Empire), Leader
WS  BS  Str  Tgh  Ag  Int  Per  Wil  Fel
40  35  25   25   30  40   35   60   70
Armor  Wounds  Critical Wounds
1      10      2
Initiative  Speed   Resolve
6           Normal  4
Skills: Awareness 45, Lore (Forbidden) 60, Rapport (Charm, Deception) 90, ...
TRAITS
Trait Name: Description...
ATTACKS
Honor Blade: Melee (One-Handed), 50, 6 + SL Damage. Penetrating (6).
Pulse Rifle: Ranged (Long Gun), 60, 10 + SL Damage, Long Range, Mag 6. Rapid Fire (2).
Possessions: Ornamental Robes, 2 Photon Grenades
```

Cells may be separated by tabs, pipes, spaces or new lines. Wrapped lines (including words hyphenated across a line break) are rejoined.

## What gets created

| Stat block | Actor |
|---|---|
| Size, species, (faction), role | `combat.size`, `species`, `faction.name`, `role` |
| Characteristics | starting values |
| Armour, Resolve | `combat.armour.value` (dice like `1d10` go into the armour formula), `combat.resolve` |
| Wounds, Critical Wounds, Initiative | Auto-calculation is left **on** when the system's own formula gives the printed number, and switched **off** with the printed value stored when it doesn't |
| Speed | land speed, plus fly speed for `Normal, Fly (Fast)` |
| Skills | advances (+5 each) that reproduce each total exactly; leftovers go in the skill modifier |
| Skill (Specialisation) | Specialisation items; `Rapport (Charm, Deception) 90` makes both |
| Traits | Trait items with the text as the description |
| Attacks | Equipped weapon items: melee/ranged, specialisation, damage (+SL), range, mag and known weapon traits. Unknown traits are kept in the weapon's description |
| Possessions | Equipment items with quantities |

If a printed attack target doesn't match what the sheet will compute from the skills, or a total needed rounding, it's listed in the preview and in the actor's GM notes.

### Matching existing items

With **Use matching items from the world & compendiums** ticked (default), any item whose name matches one in your world or an Item compendium (for example the Imperium Maledictum Core Rulebook module) is used instead, so you keep its artwork, description and scripted effects. The stat block's numbers still win: specialisation advances, weapon damage, traits and range, and possession quantity are taken from the stat block.

## Macro / API

```js
const api = game.modules.get("impmal-statblock-importer").api;
api.open();                                   // open the importer window
await api.importStatBlocks(text, { useCompendium: true, folder: null, render: true });
api.preview(text);                            // parse only, returns [{ parsed, data }]
```

## Publishing a new version

Create a GitHub release tagged with the new version (for example `v1.0.1`). The release workflow sets that version in `module.json`, builds `module.zip`, and attaches both to the release. Foundry users then see the update.

## Limitations

- Fate points and other values the NPC sheet has no field for stay in the trait text.
- Weapon category (Las, Bolt, Chain, Power …) is guessed from the weapon's name; check it if it matters.
- Ranged weapons without a `Mag N` entry get a magazine of 1.
