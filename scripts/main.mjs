import { parseStatBlock, splitStatBlocks, norm } from "./parser.mjs";
import { buildActorData } from "./builder.mjs";

const MODULE_ID = "impmal-statblock-importer";
const LOOKUP_TYPES = {
    weapon: ["weapon"],
    possession: ["equipment", "protection", "forceField", "augmetic", "weapon", "ammo"],
    trait: ["trait"],
    specialisation: ["specialisation"]
};

/* -------------------------------------------- */
/*  Compendium / world item lookup              */
/* -------------------------------------------- */

class ItemIndex
{
    constructor() { this.entries = null; }

    async load()
    {
        if (this.entries) return this.entries;
        this.entries = [];
        for (const item of game.items)
        {
            this.entries.push({ name: item.name, type: item.type, skill: item.system?.skill, uuid: item.uuid });
        }
        for (const pack of game.packs.filter(p => p.documentName === "Item"))
        {
            try
            {
                const index = await pack.getIndex({ fields: ["system.skill"] });
                for (const e of index)
                {
                    this.entries.push({ name: e.name, type: e.type, skill: e.system?.skill, uuid: e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}` });
                }
            }
            catch (err) { console.warn(`${MODULE_ID} | Couldn't index ${pack.collection}`, err); }
        }
        return this.entries;
    }

    async find({ type, name, skill })
    {
        const entries = await this.load();
        const types = LOOKUP_TYPES[type] ?? [type];
        const target = norm(name);
        const match = entries.find(e => types.includes(e.type) && norm(e.name) === target && (!skill || e.skill === skill));
        return match ? fromUuid(match.uuid) : null;
    }
}

/**
 * Replace generated items with matching world/compendium items, keeping the stat block's numbers.
 */
async function resolveItems(items, index)
{
    const resolved = [];
    for (const data of items)
    {
        const lookup = data.flags?.[MODULE_ID]?.lookup;
        const found = lookup ? await index.find(lookup) : null;
        if (!found)
        {
            resolved.push(data);
            continue;
        }
        const obj = found.toObject();
        delete obj._id;
        obj.flags = foundry.utils.mergeObject(obj.flags ?? {}, { [MODULE_ID]: { sourceUuid: found.uuid } });
        foundry.utils.setProperty(obj, "_stats.compendiumSource", found.uuid);

        if (data.type === "specialisation")
        {
            obj.system.advances = data.system.advances;
        }
        else if (data.type === "weapon")
        {
            // Stat block is authoritative for the NPC's numbers
            for (const path of ["attackType", "spec", "damage", "traits", "equipped"])
            {
                obj.system[path] = data.system[path];
            }
            if (data.system.range) obj.system.range = data.system.range;
            if (data.system.notes?.gm) obj.system.notes.gm = (obj.system.notes.gm ?? "") + data.system.notes.gm;
        }
        else if (data.type === "trait")
        {
            // Keep the stat block's wording if the compendium version has no description
            if (!obj.system.notes?.player) obj.system.notes = data.system.notes;
        }
        else if (data.type === "equipment")
        {
            obj.system.quantity = data.system.quantity;
            if (obj.system.equipped) obj.system.equipped.value = true;
        }
        resolved.push(obj);
    }
    return resolved;
}

/* -------------------------------------------- */
/*  Public API                                  */
/* -------------------------------------------- */

/**
 * Parse every stat block in `text` without creating anything.
 */
export function preview(text)
{
    return splitStatBlocks(text).map(block =>
    {
        const parsed = parseStatBlock(block);
        const data = buildActorData(parsed, { config: game.impmal?.config, localize: (s) => game.i18n.localize(s) });
        return { parsed, data };
    });
}

/**
 * Create NPC actors from every stat block in `text`.
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.useCompendium=true] Swap in matching world/compendium items
 * @param {string|null} [options.folder]          Actor folder id
 * @param {boolean} [options.render=true]         Open the sheet of each created actor
 */
export async function importStatBlocks(text, { useCompendium = true, folder = null, render = true } = {})
{
    const results = preview(text);
    if (!results.length)
    {
        ui.notifications.warn("No stat blocks found. A stat block needs at least a characteristics row (WS BS Str …).");
        return [];
    }
    const index = useCompendium ? new ItemIndex() : null;
    const created = [];
    for (const { data } of results)
    {
        const actorData = foundry.utils.deepClone(data);
        delete actorData._importNotes;
        if (folder) actorData.folder = folder;
        if (index) actorData.items = await resolveItems(actorData.items, index);
        for (const i of actorData.items)
        {
            if (i.flags?.[MODULE_ID]) delete i.flags[MODULE_ID].lookup;
        }
        const actor = await Actor.implementation.create(actorData);
        if (actor)
        {
            created.push(actor);
            if (render) actor.sheet.render(true);
        }
    }
    ui.notifications.info(`Imported ${created.length} NPC${created.length === 1 ? "" : "s"}: ${created.map(a => a.name).join(", ")}`);
    return created;
}

/* -------------------------------------------- */
/*  Importer window                             */
/* -------------------------------------------- */

const { ApplicationV2 } = foundry.applications.api;

class StatBlockImporter extends ApplicationV2
{
    static DEFAULT_OPTIONS = {
        id: "impmal-statblock-importer",
        classes: ["impmal-sbi"],
        tag: "form",
        window: { title: "Import NPC Stat Block", icon: "fa-solid fa-file-import", resizable: true },
        position: { width: 860, height: 680 },
        actions: {
            preview: StatBlockImporter.#onPreview,
            import: StatBlockImporter.#onImport,
            clear: StatBlockImporter.#onClear
        }
    };

    async _renderHTML()
    {
        const folders = game.folders.filter(f => f.type === "Actor")
            .map(f => `<option value="${f.id}">${foundry.utils.escapeHTML(f.name)}</option>`).join("");
        return `
        <div class="sbi-body">
            <div class="sbi-input">
                <label for="sbi-text">Paste one or more stat blocks (separate several with a line of <code>---</code>)</label>
                <textarea id="sbi-text" name="text" spellcheck="false" placeholder="Ethereal&#10;Medium T'au (T'au Empire), Leader&#10;WS BS Str Tgh Ag Int Per Wil Fel&#10;40 35 25 25 30 40 35 60 70&#10;…"></textarea>
                <div class="sbi-options">
                    <label><input type="checkbox" name="useCompendium" checked> Use matching items from the world &amp; compendiums</label>
                    <label>Folder <select name="folder"><option value="">—</option>${folders}</select></label>
                </div>
            </div>
            <div class="sbi-preview" data-preview><p class="sbi-hint">Paste a stat block and press <strong>Preview</strong> to check what will be created.</p></div>
        </div>
        <footer class="sbi-footer">
            <button type="button" data-action="clear"><i class="fa-solid fa-eraser"></i> Clear</button>
            <button type="button" data-action="preview"><i class="fa-solid fa-eye"></i> Preview</button>
            <button type="button" data-action="import" class="sbi-primary"><i class="fa-solid fa-user-plus"></i> Create NPC</button>
        </footer>`;
    }

    _replaceHTML(result, content)
    {
        content.innerHTML = result;
    }

    get text() { return this.element.querySelector("textarea[name=text]").value; }

    static #onClear()
    {
        this.element.querySelector("textarea[name=text]").value = "";
        this.element.querySelector("[data-preview]").innerHTML = "";
    }

    static #onPreview()
    {
        const target = this.element.querySelector("[data-preview]");
        const results = preview(this.text);
        if (!results.length)
        {
            target.innerHTML = `<p class="sbi-warn">No stat block found — it needs at least the characteristics row (WS BS Str Tgh Ag Int Per Wil Fel and their values).</p>`;
            return;
        }
        target.innerHTML = results.map(r => renderPreview(r)).join("<hr>");
    }

    static async #onImport()
    {
        const form = this.element;
        const created = await importStatBlocks(this.text, {
            useCompendium: form.querySelector("[name=useCompendium]").checked,
            folder: form.querySelector("[name=folder]").value || null
        });
        if (created.length) this.close();
    }
}

function renderPreview({ parsed, data })
{
    const e = foundry.utils.escapeHTML;
    const cfg = game.impmal?.config ?? {};
    const loc = (o, k) => (o?.[k] ? game.i18n.localize(o[k]) : k);
    const s = data.system;
    const chars = Object.entries(s.characteristics).map(([k, v]) => `<th>${k.toUpperCase()}</th>`).join("");
    const charVals = Object.values(s.characteristics).map(v => `<td>${v.starting}</td>`).join("");
    const group = (type) => data.items.filter(i => i.type === type);

    const skillList = parsed.skills.map(sk => `${loc(cfg.skills, sk.skill)}${sk.specialisation ? ` (${e(sk.specialisation)})` : ""} ${sk.total}`).join(", ");
    const weapons = group("weapon").map(w =>
    {
        const traits = w.system.traits.list.map(t => `${loc({ ...cfg.weaponArmourTraits, ...cfg.itemTraits }, t.key)}${t.value ? ` (${t.value})` : ""}`).join(", ");
        return `<li><strong>${e(w.name)}</strong> — ${loc(cfg.weaponTypes, w.system.attackType)} (${loc(cfg[`${w.system.attackType}Specs`], w.system.spec)}), ${w.system.damage.base}${w.system.damage.SL ? " + SL" : ""} Damage${w.system.range ? `, ${loc(cfg.ranges, w.system.range)} Range` : ""}${traits ? `. <em>${e(traits)}</em>` : ""}</li>`;
    }).join("");

    const warnings = [...parsed.warnings, ...data._importNotes];
    const auto = (flag) => (flag ? ` <span class="sbi-auto" title="Matches the system's own calculation, so auto-calc stays on">auto</span>` : "");
    const derived = (flag, value, printed) => (flag ? printed : value);

    return `
    <h2>${e(data.name)}</h2>
    <p class="sbi-sub">${loc(cfg.sizes, s.combat.size)} ${e(s.species)}${s.faction.name ? ` (${e(s.faction.name)})` : ""}, ${loc(cfg.npcRoles, s.role)}</p>
    <table class="sbi-table"><tr>${chars}</tr><tr>${charVals}</tr></table>
    <table class="sbi-table">
        <tr><th>Armour</th><th>Wounds</th><th>Crit. Wounds</th><th>Initiative</th><th>Speed</th><th>Resolve</th></tr>
        <tr>
            <td>${s.combat.armour.formula || s.combat.armour.value}</td>
            <td>${derived(s.autoCalc.wounds, s.combat.wounds.max, parsed.wounds)}${auto(s.autoCalc.wounds)}</td>
            <td>${derived(s.autoCalc.criticals, s.combat.criticals.max, parsed.criticals)}${auto(s.autoCalc.criticals)}</td>
            <td>${derived(s.autoCalc.initiative, s.combat.initiative, parsed.initiative)}${auto(s.autoCalc.initiative)}</td>
            <td>${loc(cfg.speeds, s.combat.speed.land.value)}${s.combat.speed.fly.value !== "none" ? `, Fly (${loc(cfg.speeds, s.combat.speed.fly.value)})` : ""}</td>
            <td>${s.combat.resolve}</td>
        </tr>
    </table>
    <p><strong>Skills:</strong> ${skillList || "—"}</p>
    <p><strong>Traits:</strong> ${group("trait").map(t => e(t.name)).join(", ") || "—"}</p>
    <p><strong>Attacks:</strong></p><ul>${weapons || "<li>—</li>"}</ul>
    <p><strong>Possessions:</strong> ${group("equipment").map(p => `${e(p.name)}${p.system.quantity > 1 ? ` ×${p.system.quantity}` : ""}`).join(", ") || "—"}</p>
    ${warnings.length ? `<div class="sbi-warn"><strong>Check these:</strong><ul>${warnings.map(w => `<li>${e(w)}</li>`).join("")}</ul></div>` : ""}`;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () =>
{
    const api = { open: () => new StatBlockImporter().render(true), importStatBlocks, preview };
    game.modules.get(MODULE_ID).api = api;
});

Hooks.once("ready", () =>
{
    if (game.system.id !== "impmal")
    {
        ui.notifications.warn(`${game.modules.get(MODULE_ID).title} only works with the Imperium Maledictum system.`);
    }
});

Hooks.on("renderActorDirectory", (app, html) =>
{
    if (game.system.id !== "impmal" || !game.user.can("ACTOR_CREATE")) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".impmal-sbi-open")) return;
    const actions = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
    if (!actions) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "impmal-sbi-open";
    button.innerHTML = `<i class="fa-solid fa-file-import"></i> Import Stat Block`;
    button.addEventListener("click", () => game.modules.get(MODULE_ID).api.open());
    actions.append(button);
});
