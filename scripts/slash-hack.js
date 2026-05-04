const MODULE_ID = "mork-borg-slash-hack";

const ATTACK_CRITS = {
  1: "Damage dice explode.",
  2: "Target rolls d3 on the Broken table.",
  3: "Target's armor degrades 1 tier. If unarmored, take +1 damage per weapon die.",
  4: "Roll damage twice.",
  5: "Win initiative next round.",
  6: "Get a free attack."
};

const ATTACK_FUMBLES = {
  1: "Weapon dropped/unusable for 1 round.",
  2: "Halve weapon damage next round.",
  3: "Weapon lost/unusable for d4 rounds.",
  4: "Target gets a free attack.",
  5: "Permanent -1 weapon damage.",
  6: "Weapon breaks."
};

const DEFENCE_CRITS = {
  1: "Get a free attack.",
  2: "-1 damage.",
  3: "+d2 HP; lose them when combat ends.",
  4: "Armor reduces damage x1.5.",
  5: "Armor reduces damage x2.",
  6: "Roll armor die twice.",
  7: "Regain an Omen.",
  8: "Take a free turn.",
  9: "Attacker checks morale.",
  10: "Armor dice explode."
};

const DEFENCE_FUMBLES = {
  1: "Drop your weapon/shield/random item.",
  2: "Provoke another attack.",
  3: "Become infected (MB p. 31).",
  4: "Roll damage twice.",
  5: "Fall unconscious for d4 rounds.",
  6: "Armor degrades 1 tier. If unarmored, take +1 damage per weapon die.",
  7: "Broken/severed limb (MB p. 21).",
  8: "Damage dice explode.",
  9: "Hemorrhage (MB p. 21).",
  10: "You die :("
};

Hooks.once("ready", () => {
  const api = {
    rollAttack: slashHackAttack,
    rollDefend: slashHackDefend
  };
  game.modules.get(MODULE_ID).api = api;
  window.SlashHackCombat = api;
});

for (const hook of ["renderActorSheet", "renderMBActorSheet", "renderMBCharacterSheet", "renderMBCreatureSheet", "renderMBFollowerSheet"]) {
  Hooks.on(hook, bindCombatButtons);
}

function bindCombatButtons(sheet, html) {
  if (game.system.id !== "morkborg") return;
  const root = html[0];
  if (!root || root.dataset.slashHackBound) return;
  root.dataset.slashHackBound = "true";
  root.addEventListener("click", (event) => {
    const button = event.target.closest?.(".attack-button");
    if (!button || !root.contains(button)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const row = button.closest(".item");
    const itemId = row?.dataset?.itemId;
    slashHackAttack(sheet.actor, itemId);
  }, true);
  root.addEventListener("click", (event) => {
    const button = event.target.closest?.(".defend-button");
    if (!button || !root.contains(button)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    slashHackDefend(sheet.actor);
  }, true);

  root.querySelectorAll(".attack-rule").forEach((element) => {
    element.textContent = "/hack: attacks automatically hit. Roll weapon die and target armor die together.";
  });
  root.querySelectorAll(".defend-rule").forEach((element) => {
    element.textContent = "/hack: roll armor die and incoming attack die together.";
  });
}

async function slashHackAttack(attacker, itemId) {
  if (!attacker) {
    ui.notifications.warn("No attacking actor found.");
    return;
  }

  const weapon = itemId ? attacker.items.get(itemId) : equippedWeapon(attacker);
  if (!weapon) {
    ui.notifications.warn(`${attacker.name} has no selected weapon.`);
    return;
  }

  const defaults = {
    ...buildAttackDefaults(attacker, weapon),
    ...getDialogState(attacker, "attack", weapon.id)
  };
  const form = await promptAttack(attacker, weapon, defaults);
  if (!form) return;
  await setDialogState(attacker, "attack", weapon.id, pickState(form, ["armorDie", "armorMod", "situationMod"]));

  await rollSlashHack({
    actor: attacker,
    attackFormula: weapon.system.damageDie,
    attackImg: weapon.img,
    attackLabel: weapon.name,
    cardTitle: "/hack Attack",
    form
  });
}

async function slashHackDefend(actor) {
  if (!actor) {
    ui.notifications.warn("No defending actor found.");
    return;
  }

  const baseDefaults = buildDefendDefaults(actor);
  const saved = getDialogState(actor, "defend");
  if (saved.armorSignature !== baseDefaults.armorSignature) delete saved.armorDie;
  const defaults = { ...baseDefaults, ...saved };
  const form = await promptDefend(actor, defaults);
  if (!form) return;
  await setDialogState(actor, "defend", null, {
    ...pickState(form, ["armorDie", "armorMod", "attackDie", "situationMod"]),
    armorSignature: baseDefaults.armorSignature
  });

  await rollSlashHack({
    actor,
    attackFormula: form.attackDie,
    attackImg: "icons/svg/sword.svg",
    attackLabel: "Incoming attack",
    cardTitle: "/hack Defend",
    form
  });
}

function buildAttackDefaults(attacker, weapon) {
  const abilityKey = weapon.system.weaponType === "ranged" ? "presence" : "strength";
  const abilityMod = Number(attacker.system.abilities?.[abilityKey]?.value ?? 0);

  return {
    abilityKey,
    abilityLabel: abilityKey === "presence" ? "Presence" : "Strength",
    armorDie: "",
    armorMod: 0,
    weaponId: weapon.id,
    abilityMod,
    situationMod: 0
  };
}

function buildDefendDefaults(actor) {
  const armor = actor.equippedArmor?.();
  const shield = actor.equippedShield?.();
  const tierDie = armor ? CONFIG.MB.armorTiers[armor.system.tier.value].damageReductionDie : "";
  const armorDie = isUnarmoredDie(tierDie) ? "" : tierDie;
  const armorMod = armorDie && shield ? 1 : 0;

  return {
    armorDie,
    armorMod,
    armorSignature: armorDie ? `${armor.id}:${armor.system.tier.value}` : "unarmored",
    attackDie: "1d4",
    situationMod: 0
  };
}

function equippedWeapon(actor) {
  return actor.items.find((item) => item.type === "weapon" && item.system.equipped)
    ?? actor.items.find((item) => item.type === "weapon");
}

function stateKey(actor, mode, itemId = null) {
  return [
    MODULE_ID,
    game.world?.id ?? "world",
    game.user?.id ?? "user",
    actor.id,
    mode,
    itemId
  ].filter(Boolean).join(".");
}

function getDialogState(actor, mode, itemId = null) {
  try {
    return JSON.parse(sessionStorage.getItem(stateKey(actor, mode, itemId)) ?? "{}");
  } catch {
    return {};
  }
}

async function setDialogState(actor, mode, itemId, values) {
  sessionStorage.setItem(stateKey(actor, mode, itemId), JSON.stringify(values));
}

function pickState(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

async function promptAttack(attacker, weapon, defaults) {
  const content = `
    <form class="slash-hack-dialog">
      <input type="hidden" name="weaponId" value="${escapeHtml(weapon.id)}" />
      <p class="hint">${escapeHtml(attacker.name)} attacks with ${escapeHtml(weapon.name)}.</p>
      <div class="form-group">
        <label>Weapon die</label>
        <input type="text" name="weaponDie" value="${escapeHtml(weapon.system.damageDie)}" readonly />
      </div>
      <div class="form-group">
        <label>${defaults.abilityLabel} modifier</label>
        <input class="slash-hack-readonly" type="number" name="abilityMod" value="${defaults.abilityMod}" readonly tabindex="-1" />
      </div>
      <div class="form-group">
        <label>Situational modifier</label>
        <input type="number" name="situationMod" value="${defaults.situationMod}" />
      </div>
      <div class="form-group">
        <label>Armor die</label>
        <input type="text" name="armorDie" value="${escapeHtml(defaults.armorDie)}" placeholder="d2, d4, d6, blank if unarmored" />
      </div>
      <div class="form-group">
        <label>Armor modifier</label>
        <input type="number" name="armorMod" value="${defaults.armorMod}" />
      </div>
      <p class="hint">/hack attacks automatically hit. Apply ability and DR modifiers, minimum 1. Do not include armor penalties.</p>
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: "/hack Attack",
      content,
      buttons: {
        roll: {
          icon: '<i class="fas fa-dice-d6"></i>',
          label: "Roll /hack",
          callback: (html) => resolve(readSlashHackForm(html[0].querySelector("form")))
        }
      },
      default: "roll",
      close: () => resolve(null)
    }).render(true);
  });
}

async function promptDefend(actor, defaults) {
  const content = `
    <form class="slash-hack-dialog">
      <p class="hint">${escapeHtml(actor.name)} defends with /hack.</p>
      <div class="form-group">
        <label>Armor die</label>
        <input type="text" name="armorDie" value="${escapeHtml(defaults.armorDie)}" placeholder="d2, d4, d6, blank if unarmored" />
      </div>
      <div class="form-group">
        <label>Armor modifier</label>
        <input type="number" name="armorMod" value="${defaults.armorMod}" />
      </div>
      <div class="form-group">
        <label>Attack die</label>
        <input type="text" name="attackDie" value="${escapeHtml(defaults.attackDie)}" placeholder="1d4" />
      </div>
      <div class="form-group">
        <label>Situation modifier</label>
        <input type="number" name="situationMod" value="${defaults.situationMod}" />
      </div>
      <p class="hint">Armor die uses the current armor tier by default.</p>
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: "/hack Defend",
      content,
      buttons: {
        roll: {
          icon: '<i class="fas fa-dice-d6"></i>',
          label: "Roll /hack",
          callback: (html) => resolve(readSlashHackForm(html[0].querySelector("form")))
        }
      },
      default: "roll",
      close: () => resolve(null)
    }).render(true);
  });
}

function readSlashHackForm(form) {
  return {
    abilityMod: Number(form.abilityMod?.value || 0),
    armorDie: form.armorDie.value.trim(),
    armorMod: Number(form.armorMod.value || 0),
    attackDie: form.attackDie?.value.trim(),
    weaponId: form.weaponId?.value,
    situationMod: Number(form.situationMod.value || 0)
  };
}

async function rollSlashHack({ actor, attackFormula, attackImg, attackLabel, cardTitle, form }) {
  const armorDie = normalizeDie(form.armorDie);
  const normalizedAttackFormula = normalizeDie(attackFormula);
  if (!normalizedAttackFormula) {
    ui.notifications.warn("Attack die is required.");
    return;
  }

  const weaponRoll = await new Roll(normalizedAttackFormula).evaluate();
  const armorRoll = armorDie ? await new Roll(armorDie).evaluate() : null;
  const diceRolls = [weaponRoll, armorRoll].filter(Boolean);
  if (game.dice3d) {
    await Promise.all(diceRolls.map((roll) => game.dice3d.showForRoll(roll, game.user, true, null, false)));
  }

  const weaponDice = dieResults(weaponRoll);
  const armorDice = armorRoll ? dieResults(armorRoll) : [{ raw: 1, faces: 1 }];
  const weaponRaw = weaponDice[0]?.raw ?? 1;
  const armorRaw = armorDice[0]?.raw ?? 1;
  const weaponModifier = Number(form.abilityMod || 0) + Number(form.situationMod || 0);
  const baseWeaponTotal = Math.max(weaponRoll.total + weaponModifier, 1);
  const armorTotal = armorRoll ? Math.max(armorRoll.total + Number(form.armorMod || 0), 1) : 0;
  const effects = [];
  for (const [index, die] of weaponDice.entries()) {
    const label = weaponDice.length > 1 ? `Attack Crit #${index + 1}` : "Attack Crit";
    addEffect(effects, label, die.raw === die.faces, ATTACK_CRITS, armorRaw);
    const fumbleLabel = weaponDice.length > 1 ? `Attack Fumble #${index + 1}` : "Attack Fumble";
    addEffect(effects, fumbleLabel, die.raw === 1, ATTACK_FUMBLES, armorRaw);
  }
  for (const [index, die] of armorDice.entries()) {
    const label = armorDice.length > 1 ? `Defence Crit #${index + 1}` : "Defence Crit";
    addEffect(effects, label, armorRoll && die.raw === die.faces, DEFENCE_CRITS, weaponRaw);
    const fumbleLabel = armorDice.length > 1 ? `Defence Fumble #${index + 1}` : "Defence Fumble";
    addEffect(effects, fumbleLabel, !armorRoll || die.raw === 1, DEFENCE_FUMBLES, weaponRaw);
  }

  const explosionRolls = await rollDamageExplosions(normalizedAttackFormula, armorRaw, effects);
  const explosionDamage = explosionRolls.reduce((total, roll) => total + roll.total, 0);
  if (game.dice3d && explosionRolls.length) {
    await Promise.all(explosionRolls.map((roll) => game.dice3d.showForRoll(roll, game.user, true, null, false)));
  }

  const damageTwiceRolls = await rollDamageTwice(normalizedAttackFormula, effects);
  const damageTwiceDamage = damageTwiceRolls.reduce((total, roll) => total + roll.total, 0);
  if (game.dice3d && damageTwiceRolls.length) {
    await Promise.all(damageTwiceRolls.map((roll) => game.dice3d.showForRoll(roll, game.user, true, null, false)));
  }

  const armorDegradeUnarmored = !armorRoll && effects.some((effect) => effect.text.includes("degrades 1 tier"));
  const unarmoredPenalty = armorDegradeUnarmored ? countDice(weaponRoll) : 0;
  const weaponTotal = baseWeaponTotal + explosionDamage + damageTwiceDamage;
  const damage = Math.max(weaponTotal - armorTotal + unarmoredPenalty, 0);
  const effectRolls = await resolveEffectRolls(effects);

  const html = renderCard({
    armorDie,
    armorRoll,
    armorTotal,
    actor,
    attackImg,
    attackLabel,
    cardTitle,
    damage,
    damageTwiceDamage,
    damageTwiceRolls,
    effects,
    explosionDamage,
    explosionRolls,
    unarmoredPenalty,
    weaponModifier,
    weaponRoll,
    weaponTotal
  });

  const content = await foundry.applications.ux.TextEditor.implementation.enrichHTML(html);
  await ChatMessage.create({
    content,
    rolls: [...diceRolls, ...explosionRolls, ...damageTwiceRolls, ...effectRolls],
    sound: game.dice3d ? null : CONFIG.sounds.dice,
    speaker: ChatMessage.getSpeaker({ actor })
  });
}

function addEffect(effects, label, active, table, opposingRaw) {
  if (!active) return;
  const key = clampTableKey(opposingRaw, table);
  effects.push({ label, roll: key, text: table[key] });
}

async function rollDamageExplosions(weaponFormula, armorRaw, effects) {
  if (!effects.some((effect) => effect.text === "Damage dice explode.")) return [];

  const rolls = [];
  let shouldExplode = true;
  while (shouldExplode) {
    const roll = await new Roll(weaponFormula).evaluate();
    rolls.push(roll);
    const dice = dieResults(roll);
    shouldExplode = dice.some((die) => die.raw === die.faces)
      && ATTACK_CRITS[clampTableKey(armorRaw, ATTACK_CRITS)] === "Damage dice explode.";
  }
  return rolls;
}

async function rollDamageTwice(weaponFormula, effects) {
  const count = effects.filter((effect) => effect.text === "Roll damage twice.").length;
  const rolls = [];
  for (let i = 0; i < count; i += 1) {
    rolls.push(await new Roll(weaponFormula).evaluate());
  }
  return rolls;
}

async function resolveEffectRolls(effects) {
  const rolls = [];
  for (const effect of effects) {
    effect.text = await replaceEffectDice(effect.text, rolls);
  }
  return rolls;
}

async function replaceEffectDice(text, rolls) {
  const parts = [];
  let cursor = 0;
  const regex = /\bd([234])\b/g;
  for (const match of text.matchAll(regex)) {
    parts.push(escapeHtml(text.slice(cursor, match.index)));
    const formula = `1${match[0]}`;
    const roll = await new Roll(formula).evaluate();
    rolls.push(roll);
    parts.push(renderResolvedInlineRoll(roll, match[0]));
    cursor = match.index + match[0].length;
  }
  parts.push(escapeHtml(text.slice(cursor)));
  return parts.join("");
}

function renderResolvedInlineRoll(roll, label) {
  return `<a class="inline-roll inline-result" title="${escapeHtml(roll.formula)}"><i class="fas fa-dice-d20"></i> ${escapeHtml(label)}: ${roll.total}</a>`;
}

function clampTableKey(raw, table) {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  return Math.min(Math.max(Number(raw || 1), keys[0]), keys[keys.length - 1]);
}

function normalizeDie(formula) {
  if (!formula) return "";
  const cleaned = String(formula).trim();
  if (!cleaned) return "";
  if (isUnarmoredDie(cleaned)) return "";
  return cleaned.startsWith("d") ? `1${cleaned}` : cleaned;
}

function isUnarmoredDie(formula) {
  return ["0", "1d0", "d0"].includes(String(formula ?? "").trim().toLowerCase());
}

function dieResults(roll) {
  const results = [];
  for (const die of roll.dice ?? []) {
    for (const result of die.results ?? []) {
      if (result.discarded || result.rerolled) continue;
      results.push({
        faces: Number(die.faces ?? result.result),
        raw: Number(result.result)
      });
    }
  }
  return results.length ? results : [{ raw: Number(roll.total || 1), faces: Number(roll.total || 1) }];
}

function countDice(roll) {
  return roll.dice?.reduce((total, die) => total + die.results.length, 0) ?? 1;
}

function renderCard(data) {
  const effects = data.effects.length
    ? data.effects.map((effect) => `<li><strong>${effect.label} ${effect.roll}:</strong> ${effect.text}</li>`).join("")
    : "<li>No crit or fumble effects.</li>";
  const penalty = data.unarmoredPenalty
    ? `<p class="slash-hack-note">Unarmored armor degradation: +${data.unarmoredPenalty} damage.</p>`
    : "";
  const armorLine = data.armorRoll
    ? `<span>Armor: ${escapeHtml(data.armorRoll.formula)}</span>`
    : "<span>Armor: unarmored defence fumble</span>";
  const armorResult = data.armorRoll
    ? `<span>${data.armorRoll.total} + ${Number(data.armorTotal) - Number(data.armorRoll.total)} = ${data.armorTotal}</span>`
    : "<span>0</span>";
  const explosionRows = data.explosionRolls.length
    ? data.explosionRolls.map((roll, index) => `
      <div class="roll-result">
        <div class="roll-title">
          <span>Explosion #${index + 1}: ${escapeHtml(roll.formula)}</span>
        </div>
        <div class="roll-row">
          <span>${roll.total}</span>
        </div>
      </div>
    `).join("")
    : "";
  const damageTwiceRows = data.damageTwiceRolls.length
    ? data.damageTwiceRolls.map((roll, index) => `
      <div class="roll-result">
        <div class="roll-title">
          <span>Damage twice #${index + 1}: ${escapeHtml(roll.formula)}</span>
        </div>
        <div class="roll-row">
          <span>${roll.total}</span>
        </div>
      </div>
    `).join("")
    : "";
  const totalRow = `
    <div class="roll-result slash-hack-total">
      <div class="roll-title">
        <span>Total</span>
      </div>
      <div class="roll-row">
        <span>
          base ${data.weaponRoll.total}
          + mod ${data.weaponModifier}
          + explode ${data.explosionDamage}
          + extra ${data.damageTwiceDamage}
          = ${data.weaponTotal}
        </span>
      </div>
    </div>
  `;

  return `
    <form class="roll-card attack-roll-card slash-hack-card">
      <div class="card-title">${escapeHtml(data.cardTitle)}</div>
      <div class="item-row">
        <img src="${escapeHtml(data.attackImg)}" title="${escapeHtml(data.attackLabel)}" width="24" height="24" />
        <span class="item-name">${escapeHtml(data.actor.name)}</span>
      </div>
      <div class="roll-result">
        <div class="roll-title">
          <span>${escapeHtml(data.attackLabel)}: ${escapeHtml(data.weaponRoll.formula)}</span>
        </div>
        <div class="roll-row">
          <span>${data.weaponRoll.total}</span>
        </div>
      </div>
      ${explosionRows}
      ${damageTwiceRows}
      ${totalRow}
      <div class="roll-result">
        <div class="roll-title">${armorLine}</div>
        <div class="roll-row">${armorResult}</div>
      </div>
      <div class="outcome-row">
        <span>Damage: <strong>${data.damage}</strong></span>
      </div>
      ${penalty}
      <ol>${effects}</ol>
    </form>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
