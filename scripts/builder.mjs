import { CHARACTERISTICS, SKILL_CHARACTERISTICS, norm } from "./parser.mjs";

/** Fallback weapon/item trait keys if the system config isn't available (e.g. in tests) */
const FALLBACK_TRAITS = {
    blast: "Blast", burst: "Burst", close: "Close", defensive: "Defensive", flamer: "Flamer",
    heavy: "Heavy", ineffective: "Ineffective", inflict: "Inflict", loud: "Loud",
    penetrating: "Penetrating", rapidFire: "Rapid Fire", reach: "Reach", reliable: "Reliable",
    rend: "Rend", shield: "Shield", spread: "Spread", subtle: "Subtle", supercharge: "Supercharge",
    thrown: "Thrown", twohanded: "Two-Handed", unstable: "Unstable",
    bulky: "Bulky", shoddy: "Shoddy", ugly: "Ugly", unreliable: "Unreliable",
    lightweight: "Lightweight", mastercrafted: "Mastercrafted", ornamental: "Ornamental", durable: "Durable"
};

const FALLBACK_SPEC_LABELS = {
    oneHanded: "One Handed", twoHanded: "Two Handed", brawling: "Brawling",
    pistol: "Pistols", longGun: "Long Guns", ordnance: "Ordnance", thrown: "Thrown", engineering: "Engineering"
};

/** Guess the system's weapon category from the weapon's name */
function guessCategory(name, attackType)
{
    const n = name.toLowerCase();
    if (attackType === "melee")
    {
        if (/chain|eviscerator/.test(n)) return "chain";
        if (/power|thunder hammer|crozius/.test(n)) return "power";
        if (/shock|electro|taser|stun/.test(n)) return "shock";
        if (/force/.test(n)) return "force";
        return "mundane";
    }
    if (/pulse|rail|ion |burst cannon|shuriken|splinter|gauss|needle|web/.test(n)) return "specialised";
    if (/bolt/.test(n)) return "bolt";
    if (/flam|burn|incinerat/.test(n)) return "flame";
    if (/\blas|hellgun|hot-shot/.test(n)) return "las";
    if (/melta|fusion/.test(n)) return "melta";
    if (/plasma/.test(n)) return "plasma";
    if (/grenade|krak|frag|charge|bomb|mine/.test(n)) return "grenadesExplosives";
    if (/launcher|missile|rocket/.test(n)) return "launcher";
    if (/stub|auto|shotgun|revolver|sniper|rifle|pistol|cannon/.test(n)) return "solid";
    return "specialised";
}

const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Work out advances (+5 each) and a leftover modifier that reproduce a target total.
 */
function advancesFor(total, base)
{
    const diff = total - base;
    if (diff <= 0) return { advances: 0, modifier: diff };
    return { advances: Math.floor(diff / 5), modifier: diff % 5 };
}

/**
 * Build Actor creation data for an ImpMal NPC.
 * @param {object} parsed   Output of parseStatBlock
 * @param {object} [env]
 * @param {object} [env.config]     game.impmal.config (optional)
 * @param {Function} [env.localize] game.i18n.localize (optional)
 * @param {boolean} [env.keepAutoCalc=true] Leave auto-calculation on when it reproduces the printed value
 */
export function buildActorData(parsed, { config = null, localize = (s) => s, keepAutoCalc = true } = {})
{
    const notes = [];
    const items = [];

    const traitLabels = config ? { ...config.weaponArmourTraits, ...config.itemTraits } : FALLBACK_TRAITS;
    const traitHasValue = config?.traitHasValue ?? { heavy: 1, inflict: 1, penetrating: 1, rapidFire: 1, rend: 1, shield: 1, supercharge: 1, thrown: 1 };
    const traitLookup = {};
    for (const [key, label] of Object.entries(traitLabels))
    {
        traitLookup[norm(localize(label))] = key;
        traitLookup[norm(key)] = key;
    }
    traitLookup.twohanded = "twohanded";

    const specLabel = (type, key) =>
    {
        const label = config?.[`${type}Specs`]?.[key];
        return label ? localize(label) : FALLBACK_SPEC_LABELS[key];
    };

    // ---------- Characteristics ----------
    const characteristics = {};
    const ch = {};
    for (const c of CHARACTERISTICS)
    {
        const value = parsed.characteristics[c] ?? 20;
        ch[c] = value;
        characteristics[c] = { starting: value, modifier: 0, advances: 0 };
    }
    const bonus = (c) => Math.floor(ch[c] / 10);

    // ---------- Skills & specialisations ----------
    const skills = {};
    const baseTotals = {};
    for (const s of parsed.skills.filter(s => !s.specialisation))
    {
        const base = ch[SKILL_CHARACTERISTICS[s.skill]];
        skills[s.skill] = advancesFor(s.total, base);
        baseTotals[s.skill] = s.total;
        if (skills[s.skill].modifier) notes.push(`${s.skill} total ${s.total} isn't a multiple of 5 above its characteristic; added a ${skills[s.skill].modifier} modifier.`);
    }

    const weaponSpecKeys = { melee: config?.meleeSpecs ?? FALLBACK_SPEC_LABELS, ranged: config?.rangedSpecs ?? FALLBACK_SPEC_LABELS };
    for (const s of parsed.skills.filter(s => s.specialisation))
    {
        const base = baseTotals[s.skill] ?? ch[SKILL_CHARACTERISTICS[s.skill]];
        const diff = s.total - base;
        const advances = Math.max(0, Math.round(diff / 5));
        if (diff % 5 !== 0 || diff < 0)
        {
            notes.push(`${s.skill} (${s.specialisation}) ${s.total}: rounded to ${advances} advance(s), final total ${base + advances * 5}.`);
        }

        // Use the system's own label for weapon specialisations so weapons find them
        let name = s.specialisation;
        if (s.skill === "melee" || s.skill === "ranged")
        {
            const map = s.skill === "melee"
                ? { onehanded: "oneHanded", twohanded: "twoHanded", brawling: "brawling" }
                : { pistol: "pistol", pistols: "pistol", longgun: "longGun", longguns: "longGun", ordnance: "ordnance", thrown: "thrown", engineering: "engineering" };
            const key = map[norm(name)];
            if (key && weaponSpecKeys[s.skill]) name = specLabel(s.skill, key);
        }

        items.push({
            name,
            type: "specialisation",
            system: { skill: s.skill, advances },
            flags: { "impmal-statblock-importer": { lookup: { type: "specialisation", skill: s.skill, name: s.specialisation } } }
        });
    }

    // ---------- Traits ----------
    for (const t of parsed.traits)
    {
        items.push({
            name: t.name,
            type: "trait",
            system: { category: "standard", notes: { player: `<p>${escapeHtml(t.description)}</p>`, gm: "" } },
            flags: { "impmal-statblock-importer": { lookup: { type: "trait", name: t.name } } }
        });
    }

    // ---------- Attacks ----------
    const skillTotal = (skill, specName) =>
    {
        const base = baseTotals[skill] ?? ch[SKILL_CHARACTERISTICS[skill]];
        const spec = items.find(i => i.type === "specialisation" && i.system.skill === skill && norm(i.name) === norm(specName ?? ""));
        return spec ? base + spec.system.advances * 5 : base;
    };

    for (const a of parsed.attacks)
    {
        const traitList = [];
        const unknownTraits = [];
        for (const t of a.traits)
        {
            const key = traitLookup[norm(t.name)];
            if (key)
            {
                const entry = { key, value: null };
                if (traitHasValue[key]) entry.value = t.value ?? "1";
                else if (t.value) entry.value = t.value;
                traitList.push(entry);
            }
            else unknownTraits.push(t.text);
        }

        const spec = a.spec ?? (a.attackType === "melee" ? "oneHanded" : "longGun");
        const playerNotes = [];
        if (unknownTraits.length) playerNotes.push(`<p><strong>Other traits:</strong> ${escapeHtml(unknownTraits.join(", "))}</p>`);
        if (a.extra) playerNotes.push(`<p>${escapeHtml(a.extra)}</p>`);

        const gmNotes = [];
        if (a.target !== null)
        {
            const computed = skillTotal(a.attackType, specLabel(a.attackType, spec));
            if (computed !== a.target)
            {
                gmNotes.push(`<p>Stat block lists a target of ${a.target}; the sheet will compute ${computed} from skills.</p>`);
                notes.push(`${a.name}: printed target ${a.target}, sheet computes ${computed}.`);
            }
        }

        const system = {
            attackType: a.attackType,
            spec,
            category: guessCategory(a.name, a.attackType),
            damage: { base: String(a.damage), characteristic: "", SL: a.SL, ignoreAP: false },
            traits: { list: traitList },
            range: a.attackType === "ranged" ? (a.range || "medium") : "",
            equipped: { value: true, force: true },
            notes: { player: playerNotes.join(""), gm: gmNotes.join("") }
        };
        if (a.attackType === "ranged" && system.category !== "grenadesExplosives")
        {
            const mag = a.mag ?? 0;
            system.mag = { value: mag || 1, current: mag || 1 };
            if (!a.mag) notes.push(`${a.name}: no Mag value in stat block, set to 1.`);
        }

        items.push({
            name: a.name,
            type: "weapon",
            system,
            flags: { "impmal-statblock-importer": { lookup: { type: "weapon", name: a.name }, keepStats: true } }
        });
    }

    // ---------- Possessions ----------
    for (const p of parsed.possessions)
    {
        items.push({
            name: p.name,
            type: "equipment",
            system: { quantity: p.quantity },
            flags: { "impmal-statblock-importer": { lookup: { type: "possession", name: p.name } } }
        });
    }

    // ---------- Combat values & auto-calculation ----------
    const autoWounds = bonus("str") + 2 * bonus("tgh") + bonus("wil");
    const autoCrits = parsed.role === "troop" ? 0 : parsed.role === "elite" ? 1 : bonus("tgh");
    const autoInit = bonus("per") + bonus("ag");

    const wounds = parsed.wounds ?? autoWounds;
    const criticals = parsed.criticals ?? autoCrits;
    const initiative = parsed.initiative ?? autoInit;

    const autoCalc = {
        wounds: keepAutoCalc && wounds === autoWounds,
        criticals: keepAutoCalc && criticals === autoCrits,
        initiative: keepAutoCalc && initiative === autoInit
    };

    const gmNoteHtml = notes.length
        ? `<p><strong>Stat block import notes</strong></p><ul>${notes.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
        : "";

    return {
        name: parsed.name,
        type: "npc",
        system: {
            characteristics,
            skills,
            species: parsed.species,
            role: parsed.role || "troop",
            faction: { name: parsed.faction },
            autoCalc,
            combat: {
                size: parsed.size,
                speed: {
                    land: { value: parsed.speed.land, modifier: 0, notes: "" },
                    fly: { value: parsed.speed.fly, modifier: 0, notes: "" }
                },
                armour: { value: parsed.armour.value, formula: parsed.armour.formula, useItems: false },
                wounds: { value: 0, max: autoCalc.wounds ? 0 : wounds },
                criticals: { value: 0, max: autoCalc.criticals ? 0 : criticals },
                initiative: autoCalc.initiative ? 0 : initiative,
                resolve: parsed.resolve ?? 0
            },
            notes: { player: "", gm: gmNoteHtml }
        },
        items,
        flags: { "impmal-statblock-importer": { importedAt: Date.now() } },
        _importNotes: notes
    };
}
