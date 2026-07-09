# Emberfall card catalog — sample (20 of 180)

Format per card: **Name** · Station · Type — flavor text, then the Leonardo
`[SUBJECT]` line to splice into the master prompt (bottom of this file).

Voice rules: 1–2 sentences, no exclamation marks, aphorisms and in-world
quotes over descriptions, the Sundering/Great Ledger/Blind Weaver lore as
background hum. Types: Beast, Vermin, Construct, Relic, Levy, Mystic,
Undead, Drake, Leviathan, Firstborn.

---

## Footman (common)

**Moss Snail** · Footman · Beast
> Sieges are won by whoever is still there in the morning. The snail has never lost one.

SUBJECT: a giant snail with a moss-covered stone shell, tiny gold-lit eyes on stalks, crawling over castle rubble

**Pixel Slime** · Footman · Mystic
> The Weaver dreams in small squares, sometimes. The maesters agreed to stop asking.

SUBJECT: a gelatinous cube-shaped slime creature made of glowing square amber blocks, faintly translucent, dripping on dungeon stones

**Tin Knight** · Footman · Construct
> Forged from melted cups and kettle scrap, he polishes his dents each dawn. Hope is also an armor.

SUBJECT: a small clumsy knight in dented patchwork tin armor, oversized great helm with a cross-shaped visor, holding a bent sword proudly

**Rusty Dagger** · Footman · Relic
> Every crown in Emberfall's history was first argued for with something like this.

SUBJECT: an ancient rusted dagger floating point-down, wrapped in a faded royal ribbon, glinting ominously in candlelight

**Levy Spearman** · Footman · Levy
> He was promised land, coin, and glory. He was given a spear and a direction.

SUBJECT: a weary peasant soldier in a padded gambeson and iron kettle-helm, clutching a long spear, standing in muddy field fog

**Bog Witch** · Footman · Mystic
> Her prices are fair. It is only afterward that you learn what things cost.

SUBJECT: a hunched old witch in tattered moss-green robes and a crooked wide-brimmed hat, stirring a small cauldron in a misty swamp, fireflies

**Plague Rat** · Footman · Vermin
> The castles quarreled over the throne. The rats quarreled over the castles. Only one side won.

SUBJECT: a large sinister black rat with matted fur and glowing pale eyes, standing over a fallen crown in a shadowy sewer

## Knight (rare)

**Storm Falcon** · Knight · Beast
> It nests in thunderheads and stoops faster than the lightning it races. The lightning has stopped racing.

SUBJECT: a fierce falcon diving through storm clouds with wings swept back, feathers crackling with faint lightning, rain streaks

**Ember Fox** · Knight · Beast
> Firstborn blood runs thin in it, but it runs. Do not follow the warm lights into the ash fields.

SUBJECT: an elegant fox with smoldering ember-orange fur, tail ending in living flame, standing in a burnt forest with drifting sparks

**Crystal Golem** · Knight · Construct
> The Ledgerkeepers built them to remember. When the last one shatters, something true is lost forever.

SUBJECT: a massive humanoid golem carved from faceted amber crystal, glowing runes across its chest, standing in a ruined library

**Raven Keeper** · Knight · Mystic
> The realm's letters stopped when the Sundering came. The ravens did not. Someone still reads them.

SUBJECT: a cloaked figure with a lantern, arm raised, covered in perched black ravens, on a crumbling tower at dusk

**Heartwood Archer** · Knight · Levy
> Her arrows are cut from the last living weirwood. Each one costs the forest a year.

SUBJECT: a stern forest ranger with a longbow of pale living wood, drawing an arrow that glows faint gold, autumn leaves swirling

## Highlord (epic)

**Void Kraken** · Highlord · Leviathan
> The drowned fleets of the Sundering did not sink. They were collected.

SUBJECT: a colossal kraken with abyssal black tentacles rising from a dark sea, one huge golden eye, broken warships in its grip, storm sky

**Shadow Dragon** · Highlord · Drake
> It does not breathe fire. It breathes the dark that is left when fire is finished.

SUBJECT: a sleek black dragon wreathed in living shadow, horns like curved daggers, exhaling darkness, ember-lit ruins below

**Dire Wolf** · Highlord · Beast
> The night before the old king died, every hound in the capital lay down and showed its throat.

SUBJECT: an enormous scarred grey wolf with bared fangs and pale gold eyes, snarling on a snowy ridge under a blood moon

**Barrow Wight** · Highlord · Undead
> The barrow-kings swore to guard the realm until the last king returned. They consider the oath open.

SUBJECT: a regal undead king in corroded ancient armor and a tarnished crown, hollow glowing eyes, rising from a burial mound in mist

## Sovereign (legendary)

**Genesis Phoenix** · Sovereign · Firstborn
> It burned before the realm was named, and it will burn after the name is forgotten. Everything between is borrowed warmth.

SUBJECT: a majestic phoenix of white-gold fire rising with wings fully spread, feathers dissolving into embers, dark cathedral ruins behind

**The Winter Sovereign** · Sovereign · Firstborn
> The throne of Emberfall is not empty. It is waiting, and winter is patient.

SUBJECT: a tall spectral monarch in ice-blue regalia and a frost crown, frozen breath, seated on an iron throne rimed with hoarfrost

## New recruits (expansion voice preview)

**Gutter Piper** · Footman · Vermin
> The rats of the capital answer to one authority, and it is not the crown.

SUBJECT: a ragged grinning street musician playing a bone flute, dozens of rat eyes glowing in the alley shadows around him

**Cinder Priestess** · Knight · Mystic
> She preaches that the Sundering was a candle, not a pyre. Her congregation grows every winter.

SUBJECT: a serene priestess in charcoal-grey robes with glowing ember patterns, holding a bowl of sacred fire, ash falling like snow

---

# Leonardo.ai master prompt

**Model:** Leonardo Phoenix (or Vision XL). **Aspect ratio 4:5** (1024×1280).
Alchemy/quality mode ON, Prompt Magic OFF (keep prompts literal). Generate 4,
pick 1, keep the same settings for every card so the set stays cohesive.

Paste this, replacing `[SUBJECT]` with the card's SUBJECT line:

```
Dark fantasy trading card illustration, painterly oil painting style, [SUBJECT].
Centered character portrait composition, three-quarter view, subject fills the
upper two thirds of the frame, dramatic golden rim lighting against deep
iron-black shadows, muted palette of ember gold, aged bronze, charcoal and
bone, grimdark medieval atmosphere, faint drifting embers and ash, plain dark
vignetted background with soft depth, highly detailed, visible brushwork,
cinematic mood, masterpiece quality.
```

**Negative prompt** (paste in Leonardo's negative field):

```
text, letters, numbers, writing, watermark, signature, logo, frame, border,
card template, UI elements, speech bubble, blurry, low quality, oversaturated,
neon colors, cartoon, anime, chibi, photograph, 3d render, extra limbs,
deformed hands, cropped head
```

**Delivery:** PNG or JPG at 1024×1280, filename = kebab-case name
(`plague-rat.png`, `the-winter-sovereign.png`), dropped in
`C:\Users\trond\Claude Code\Gachagame\cards\`. Keep the bottom ~28% of each
image free of critical detail — the name banner and flavor text overlay there.
