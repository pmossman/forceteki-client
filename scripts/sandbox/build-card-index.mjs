#!/usr/bin/env node
/**
 * Puts the card index the /sandbox board editor loads in the browser at public/sandbox/card-index.json.
 * The sandbox is meant to run as a static site, so card search works from this shipped file.
 *
 * Source, in order of preference:
 *   1. forceteki's build/sandbox/card-index.json (written by the sandbox server at start; CONTRACT.md §4);
 *   2. forceteki's raw card JSON (test/json/Card, from `npm run get-cards`), converted to the same shape
 *      with the same canonical-name rule as server/sandbox/cards/SandboxCardIndex.ts.
 *
 *   node scripts/sandbox/build-card-index.mjs [path/to/forceteki]     (default: ../forceteki)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '../..');
const engineRoot = path.resolve(process.argv[2] ?? path.join(clientRoot, '../forceteki'));
const outFile = path.join(clientRoot, 'public/sandbox/card-index.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });

const built = path.join(engineRoot, 'build/sandbox/card-index.json');
if (fs.existsSync(built)) {
    fs.copyFileSync(built, outFile);
    const count = JSON.parse(fs.readFileSync(outFile, 'utf8')).count;
    console.log(`Copied ${count} cards from ${built}`);
    process.exit(0);
}

const cardDir = path.join(engineRoot, 'test/json/Card');
if (!fs.existsSync(cardDir)) {
    console.error(`No card data at ${built} or ${cardDir}. Run the forceteki dev server once (or \`npm run get-cards\`).`);
    process.exit(1);
}

const nameKey = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const full = (c) => (c.subtitle ? `${c.title}, ${c.subtitle}` : c.title);
const num = (v) => (typeof v === 'number' ? v : undefined);

const entries = [];
for (const file of fs.readdirSync(cardDir)) {
    if (!file.endsWith('.json')) {
        continue;
    }
    let card = JSON.parse(fs.readFileSync(path.join(cardDir, file), 'utf8'));
    if (Array.isArray(card)) {
        card = card[0];
    }
    if (!card?.internalName) {
        continue;
    }
    const types = card.types ?? [];
    const setNumber = num(card.setId?.number);
    entries.push({
        internalName: card.internalName,
        name: full(card),
        title: card.title,
        subtitle: card.subtitle || undefined,
        needsSetCode: false,
        setId: { set: card.setId?.set, number: setNumber },
        setCode: setNumber != null ? `${card.setId.set}_${String(setNumber).padStart(3, '0')}` : undefined,
        id: card.id,
        types,
        arena: card.arena === 'ground' || card.arena === 'space' ? card.arena : undefined,
        cost: num(card.cost), power: num(card.power), hp: num(card.hp),
        upgradePower: num(card.upgradePower), upgradeHp: num(card.upgradeHp),
        aspects: card.aspects ?? [], traits: card.traits ?? [], keywords: card.keywords ?? [],
        unique: !!card.unique,
        text: card.text || undefined, deployBox: card.deployBox || undefined,
        epicAction: card.epicAction || undefined, pilotText: card.pilotText || undefined,
        isToken: types.includes('token'), isLeader: types.includes('leader'),
    });
}

const titleCounts = new Map();
const fullCounts = new Map();
for (const e of entries) {
    titleCounts.set(nameKey(e.title), (titleCounts.get(nameKey(e.title)) ?? 0) + 1);
    fullCounts.set(nameKey(full(e)), (fullCounts.get(nameKey(full(e))) ?? 0) + 1);
}
for (const e of entries) {
    const fullShared = fullCounts.get(nameKey(full(e))) > 1;
    const titleShared = titleCounts.get(nameKey(e.title)) > 1;
    e.needsSetCode = fullShared;
    e.name = fullShared
        ? `${full(e)} (${e.setId.set} ${String(e.setId.number ?? '').padStart(3, '0')})`
        : (titleShared || !e.subtitle) ? full(e) : e.title;
}
entries.sort((a, b) => a.name.localeCompare(b.name));
const json = { format: 'karabast-sandbox-cards', version: 1, count: entries.length, cards: JSON.parse(JSON.stringify(entries)) };
fs.writeFileSync(outFile, JSON.stringify(json));
console.log(`Built ${entries.length} cards from ${cardDir} (${entries.filter((e) => e.needsSetCode).length} need set codes) -> ${path.relative(clientRoot, outFile)}`);
