/**
 * Pure stat block parser for Warhammer 40,000: Imperium Maledictum NPC stat blocks.
 * No Foundry dependencies, so it can be unit tested in Node.
 *
 * Accepts text pasted from Word tables, PDFs, Google Docs or plain text.
 * Table cells may arrive tab-separated, one-per-line, or pipe-separated.
 */

export const CHARACTERISTICS = ["ws", "bs", "str", "tgh", "ag", "int", "per", "wil", "fel"];

export const SIZES = ["tiny", "small", "medium", "large", "enormous", "monstrous"];
export const ROLES = ["troop", "elite", "leader"];
export const SPEEDS = ["none", "slow", "normal", "fast", "swift"];
export const RANGES = ["short", "medium", "long", "extreme"];

/** Skill name (letters only, lowercase) -> system skill key */
export const SKILL_ALIASES = {
    athletics: "athletics",
    awareness: "awareness",
    dexterity: "dexterity",
    discipline: "discipline",
    fortitude: "fortitude",
    intuition: "intuition",
    linguistics: "linguistics",
    logic: "logic",
    lore: "lore",
    medicae: "medicae",
    melee: "melee",
    navigation: "navigation",
    presence: "presence",
    piloting: "piloting",
    psychic: "psychic",
    psychicmastery: "psychic",
    ranged: "ranged",
    rapport: "rapport",
    reflexes: "reflexes",
    stealth: "stealth",
    tech: "tech"
};

/** Default characteristic for each skill (mirrors the system's SkillsModel) */
export const SKILL_CHARACTERISTICS = {
    athletics: "str", awareness: "per", dexterity: "ag", discipline: "wil",
    fortitude: "tgh", intuition: "per", linguistics: "int", logic: "int",
    lore: "int", medicae: "int", melee: "ws", navigation: "int",
    presence: "wil", piloting: "ag", psychic: "wil", ranged: "bs",
    rapport: "fel", reflexes: "ag", stealth: "ag", tech: "int"
};

/** Weapon specialisation name -> system spec key */
export const MELEE_SPECS = { onehanded: "oneHanded", twohanded: "twoHanded", brawling: "brawling" };
export const RANGED_SPECS = {
    pistol: "pistol", pistols: "pistol",
    longgun: "longGun", longguns: "longGun",
    ordnance: "ordnance",
    thrown: "thrown",
    engineering: "engineering"
};

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** Split on commas that are not inside parentheses */
export function splitTopLevel(text, sep = ",")
{
    const out = [];
    let depth = 0, cur = "";
    for (const ch of text)
    {
        if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
        if (ch === sep && depth === 0)
        {
            out.push(cur);
            cur = "";
        }
        else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim()).filter(Boolean);
}

function cleanText(text)
{
    return String(text ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/[   ]/g, " ")
        .replace(/[–—]/g, "-")
        .replace(/­/g, "")              // soft hyphens
        .replace(/[|│]/g, "\t")          // table pipes -> cell breaks
        .replace(/[ ]{2,}/g, " ");
}

/**
 * Split a pasted document that may contain several stat blocks.
 * Blocks are separated by a line of three or more dashes, equals signs or asterisks.
 */
export function splitStatBlocks(text)
{
    return cleanText(text)
        .split(/\n\s*(?:-{3,}|={3,}|\*{3,})\s*\n/)
        .map(s => s.trim())
        .filter(s => /\bWS\b/i.test(s));
}

const HEADING = {
    skills: /^skills\s*:?\s*/i,
    traits: /^traits\s*:?\s*$/i,
    attacks: /^attacks\s*:?\s*$/i,
    possessions: /^possessions\s*:?\s*/i
};

/**
 * Parse one stat block.
 * @returns {object} parsed data plus a `warnings` array
 */
export function parseStatBlock(raw)
{
    const warnings = [];
    const text = cleanText(raw);
    const lines = text.split("\n").map(l => l.replace(/\t+/g, "\t").trim()).filter(Boolean);
    // Flattened version for table-ish data (cells could be on separate lines or tab separated)
    const flat = lines.join(" ").replace(/\t/g, " ").replace(/\s+/g, " ");

    const result = {
        name: "",
        size: "medium",
        species: "",
        faction: "",
        role: "",
        characteristics: {},
        armour: { value: 0, formula: "", text: "" },
        wounds: null,
        criticals: null,
        initiative: null,
        resolve: null,
        speed: { land: "normal", fly: "none", notes: "" },
        skills: [],
        traits: [],
        attacks: [],
        possessions: [],
        warnings
    };

    // ---------- Name & descriptor ----------
    result.name = (lines[0] ?? "").split("\t")[0].trim() || "Unnamed NPC";

    const descRegex = new RegExp(`^(${SIZES.join("|")})\\s+(.+?)\\s*,\\s*(${ROLES.join("|")})\\b`, "i");
    const descLine = lines.slice(0, 6).map(l => l.replace(/\t/g, " ")).find(l => descRegex.test(l));
    if (descLine)
    {
        const [, size, middle, role] = descLine.match(descRegex);
        result.size = size.toLowerCase();
        result.role = role.toLowerCase();
        const fac = middle.match(/^(.*?)\s*\((.+)\)\s*$/);
        if (fac)
        {
            result.species = fac[1].trim();
            result.faction = fac[2].trim();
        }
        else result.species = middle.trim();
    }
    else
    {
        warnings.push("Couldn't find the size/species/role line (e.g. \"Medium Human (Imperium), Troop\"). Defaulted to Medium Troop.");
        result.role = "troop";
    }

    // ---------- Characteristics ----------
    const charRegex = /\bWS\s+BS\s+S(?:tr)?\s+T(?:gh)?\s+Ag\s+Int\s+Per\s+Wil\s+Fel\s+((?:\d+\s+){8}\d+)/i;
    const charMatch = flat.match(charRegex);
    if (charMatch)
    {
        const values = charMatch[1].trim().split(/\s+/).map(Number);
        CHARACTERISTICS.forEach((c, i) => result.characteristics[c] = values[i]);
    }
    else
    {
        // Fallback: "WS 40" style pairs
        for (const [c, label] of Object.entries({ ws: "WS", bs: "BS", str: "Str?", tgh: "T(?:gh)?", ag: "Ag", int: "Int", per: "Per", wil: "Wil", fel: "Fel" }))
        {
            const m = flat.match(new RegExp(`\\b${label}\\b\\s*:?\\s*(\\d+)`, "i"));
            if (m) result.characteristics[c] = Number(m[1]);
        }
        if (Object.keys(result.characteristics).length < 9)
        {
            warnings.push("Couldn't read all nine characteristics; missing ones default to 20.");
        }
    }

    // ---------- Armour / Wounds / Critical Wounds ----------
    const awcRegex = /\bArmou?r\s+Wounds\s+Critical\s+Wounds\s+(\S+(?:\s*\([^)]*\))?)\s+(\d+)\s+(\d+)/i;
    const awc = flat.match(awcRegex);
    let armourText = null;
    if (awc)
    {
        armourText = awc[1];
        result.wounds = Number(awc[2]);
        result.criticals = Number(awc[3]);
    }
    else
    {
        armourText = flat.match(/\bArmou?r\s*:?\s*(\S+)/i)?.[1] ?? null;
        result.wounds = numOrNull(flat.match(/(?<!Critical\s)\bWounds\s*:?\s*(\d+)/i)?.[1]);
        result.criticals = numOrNull(flat.match(/\bCritical\s+Wounds\s*:?\s*(\d+)/i)?.[1]);
    }
    if (armourText)
    {
        result.armour.text = armourText;
        const dice = armourText.match(/\d*d\d+(?:\s*[+-]\s*\d+)?/i);
        if (dice) result.armour.formula = dice[0].replace(/\s+/g, "");
        else result.armour.value = Number(armourText.match(/\d+/)?.[0] ?? 0);
    }

    // ---------- Initiative / Speed / Resolve ----------
    const speedWords = SPEEDS.filter(s => s !== "none").join("|");
    const isrRegex = new RegExp(`\\bInitiative\\s+Speed\\s+Resolve\\s+(\\d+)\\s+((?:${speedWords})(?:\\s*,?\\s*Fly(?:ing)?(?:\\s*\\((?:${speedWords})\\))?)?\\*?)\\s+(\\d+)`, "i");
    const isr = flat.match(isrRegex);
    let speedText = null;
    if (isr)
    {
        result.initiative = Number(isr[1]);
        speedText = isr[2];
        result.resolve = Number(isr[3]);
    }
    else
    {
        result.initiative = numOrNull(flat.match(/\bInitiative\s*:?\s*(\d+)/i)?.[1]);
        result.resolve = numOrNull(flat.match(/\bResolve\s*:?\s*(\d+)/i)?.[1]);
        speedText = flat.match(new RegExp(`\\bSpeed\\s*:?\\s*((?:${speedWords})(?:\\s*,?\\s*Fly(?:ing)?(?:\\s*\\((?:${speedWords})\\))?)?)`, "i"))?.[1] ?? null;
    }
    if (speedText)
    {
        const land = speedText.match(new RegExp(`^(${speedWords})`, "i"));
        if (land) result.speed.land = land[1].toLowerCase();
        const fly = speedText.match(new RegExp(`Fly(?:ing)?(?:\\s*\\((${speedWords})\\))?`, "i"));
        if (fly) result.speed.fly = (fly[1] ?? result.speed.land).toLowerCase();
    }
    if (result.wounds === null) warnings.push("Wounds not found.");

    // ---------- Sections ----------
    const sections = splitSections(lines);

    result.skills = parseSkills(sections.skills, warnings);
    result.traits = parseEntries(sections.traits).map(e => ({ name: e.name, description: e.text }));
    result.attacks = parseEntries(sections.attacks).map(e => parseAttack(e, warnings)).filter(Boolean);
    result.possessions = parsePossessions(sections.possessions);

    return result;
}

function numOrNull(v)
{
    return v === undefined || v === null ? null : Number(v);
}

/** Group lines under their section headings */
function splitSections(lines)
{
    const sections = { skills: [], traits: [], attacks: [], possessions: [] };
    let current = null;
    for (let line of lines)
    {
        line = line.replace(/\t/g, " ").trim();
        let matched = false;
        for (const [key, regex] of Object.entries(HEADING))
        {
            if (regex.test(line))
            {
                current = key;
                const rest = line.replace(regex, "").trim();
                if (rest) sections[key].push(rest);
                matched = true;
                break;
            }
        }
        if (!matched && current) sections[current].push(line);
    }
    return sections;
}

function parseSkills(lines, warnings)
{
    const text = lines.join(" ").replace(/\s+/g, " ").replace(/\.$/, "");
    const skills = [];
    for (const entry of splitTopLevel(text))
    {
        const m = entry.match(/^(.+?)\s*(?:\(([^)]*)\))?\s*(\d+)$/);
        if (!m)
        {
            warnings.push(`Couldn't read skill "${entry}".`);
            continue;
        }
        const [, rawName, specText, total] = m;
        const key = SKILL_ALIASES[norm(rawName)];
        if (!key)
        {
            warnings.push(`Unknown skill "${rawName}" — skipped.`);
            continue;
        }
        if (specText)
        {
            // "Rapport (Charm, Deception) 90" -> two specialisations at 90
            for (const spec of splitTopLevel(specText))
            {
                skills.push({ skill: key, specialisation: spec.trim(), total: Number(total) });
            }
        }
        else skills.push({ skill: key, specialisation: null, total: Number(total) });
    }
    return skills;
}

/**
 * Split section lines into "Name: text" entries, joining wrapped lines.
 */
function parseEntries(lines)
{
    const entries = [];
    for (const line of lines)
    {
        const m = line.match(/^([^:.]{2,60}?):\s*(.*)$/);
        if (m && /^[A-Z0-9'"‘’]/.test(m[1]))
        {
            entries.push({ name: m[1].trim(), text: m[2].trim() });
        }
        else if (entries.length)
        {
            const last = entries[entries.length - 1];
            last.text = joinWrapped(last.text, line);
        }
    }
    return entries;
}

function joinWrapped(a, b)
{
    if (!a) return b;
    // Rejoin words hyphenated across a line break ("Battle-\nsuits")
    if (/[a-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
    return `${a} ${b}`;
}

/**
 * Parse an attack such as
 *   "Honor Blade: Melee (One-Handed), 50, 6 + SL Damage. Penetrating (6)."
 *   "Pulse Rifle: Ranged (Long Gun), 40, 10 + SL Damage, Long Range, Mag 6. Rapid Fire (2)."
 */
export function parseAttack({ name, text }, warnings = [])
{
    const m = text.match(/^(Melee|Ranged)\s*(?:\(([^)]*)\))?\s*,\s*(\d+)\s*,\s*(.*)$/i);
    if (!m)
    {
        warnings.push(`Couldn't read attack "${name}: ${text}". It was added as a weapon with no stats.`);
        return { name, attackType: "melee", spec: null, specLabel: null, target: null, damage: "0", SL: true, range: "", mag: null, traits: [], extra: text };
    }
    const [, type, specText, target, rest] = m;
    const attackType = type.toLowerCase();
    const specMap = attackType === "melee" ? MELEE_SPECS : RANGED_SPECS;
    const spec = specText ? (specMap[norm(specText)] ?? null) : (attackType === "melee" ? "oneHanded" : null);
    if (specText && !spec) warnings.push(`Attack "${name}": unknown specialisation "${specText}".`);

    // Head = everything up to the first sentence break; tail = trait list
    const sentence = rest.match(/^(.*?)(?:\.\s+|\.$|$)(.*)$/);
    const head = sentence[1];
    const tail = (sentence[2] ?? "").replace(/\.\s*$/, "");

    let damage = "0", SL = false, range = "", mag = null;
    const extra = [];
    const traitTexts = [];
    for (const part of splitTopLevel(head))
    {
        let pm;
        if ((pm = part.match(/^(\d+)\s*(\+\s*SL)?\s*Damage$/i)))
        {
            damage = pm[1];
            SL = !!pm[2];
        }
        else if ((pm = part.match(/^Damage\s*:?\s*(\d+)\s*(\+\s*SL)?$/i)))
        {
            damage = pm[1];
            SL = !!pm[2];
        }
        else if ((pm = part.match(new RegExp(`^(${RANGES.join("|")})\\s+Range$`, "i"))))
        {
            range = pm[1].toLowerCase();
        }
        else if ((pm = part.match(new RegExp(`^Range\\s*:?\\s*(${RANGES.join("|")})$`, "i"))))
        {
            range = pm[1].toLowerCase();
        }
        else if ((pm = part.match(/^Mag(?:azine)?\s*:?\s*(\d+)$/i)))
        {
            mag = Number(pm[1]);
        }
        else traitTexts.push(part);
    }
    traitTexts.push(...splitTopLevel(tail));

    const traits = [];
    for (const t of traitTexts)
    {
        const tm = t.match(/^(.+?)\s*(?:\(([^)]*)\))?$/);
        if (tm) traits.push({ name: tm[1].trim(), value: tm[2]?.trim() ?? null, text: t });
        else extra.push(t);
    }

    return {
        name, attackType, spec, specLabel: specText?.trim() ?? null,
        target: Number(target), damage, SL, range, mag, traits,
        extra: extra.join(", ")
    };
}

function parsePossessions(lines)
{
    const text = lines.join(" ").replace(/\s+/g, " ").replace(/\.$/, "").trim();
    if (!text || /^(none|-)$/i.test(text)) return [];
    return splitTopLevel(text).map(entry =>
    {
        let name = entry, quantity = 1, m;
        if ((m = entry.match(/^(\d+)\s*(?:x\s*)?(.+)$/i))) { quantity = Number(m[1]); name = m[2]; }
        else if ((m = entry.match(/^(.+?)\s*(?:x\s*(\d+)|\((\d+)\))$/i))) { name = m[1]; quantity = Number(m[2] ?? m[3]); }
        return { name: name.trim(), quantity };
    });
}
