'use client';

import { LOCATIONS, daylight, isSunset, minuteOfDay, type AnimationId, type WorldObject } from '@calmling/core';
import type { AssetManifest, CalmlingRenderer, RenderInputs } from './types';

type PhaserNS = typeof import('phaser');

/** world units → pixels */
const S = 4;
const W = 1280;
const H = 720;
const GROUND = 560;
const WORLD_PX = 1000 * S;
const CHAR_SCALE = 1.4;

const C = {
  skyDayTop: 0x9fc4e4,
  skyDayBottom: 0xf6efe0,
  skyDuskTop: 0x6f6aa8,
  skyDuskBottom: 0xf3b79a,
  skyNightTop: 0x111a33,
  skyNightBottom: 0x2b3456,
  grass: 0x9cc38f,
  grassDark: 0x7ea67f,
  soil: 0xa9825f,
  water: 0x7fb2d6,
  wood: 0xb58a62,
  woodDark: 0x8a6446,
  wall: 0xf3e6cf,
  wallDark: 0xe4d2b4,
  roof: 0xc77f68,
  body: 0xcdd8ef,
  bodyShade: 0xb3c2e3,
  belly: 0xf2f5fc,
  eye: 0x2b2f3a,
  blush: 0xf2b6b0,
};

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export class PhaserRenderer implements CalmlingRenderer {
  private game: import('phaser').Game | null = null;

  constructor(private manifest: AssetManifest) {}

  async mount(el: HTMLElement, read: () => RenderInputs | null) {
    const Phaser = (await import('phaser')).default as unknown as PhaserNS;
    const manifest = this.manifest;
    const scene = makeScene(Phaser, manifest, read);
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: el,
      width: W,
      height: H,
      backgroundColor: '#f6efe0',
      transparent: false,
      antialias: true,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene,
      fps: { target: 60, smoothStep: true },
      banner: false,
      audio: { noAudio: true },
    });
  }

  destroy() {
    this.game?.destroy(true);
    this.game = null;
  }
}

function makeScene(Phaser: PhaserNS, manifest: AssetManifest, read: () => RenderInputs | null) {
  return class IslandScene extends Phaser.Scene {
    sky!: import('phaser').GameObjects.Graphics;
    celestial!: import('phaser').GameObjects.Graphics;
    stars!: import('phaser').GameObjects.Graphics;
    clouds: { g: import('phaser').GameObjects.Graphics; x: number; y: number; speed: number }[] = [];
    nightOverlay!: import('phaser').GameObjects.Rectangle;
    glows!: import('phaser').GameObjects.Graphics;
    rain!: import('phaser').GameObjects.Graphics;
    rainDrops: { x: number; y: number; v: number }[] = [];
    objectViews = new Map<string, { c: import('phaser').GameObjects.Container; sig: string }>();
    char!: import('phaser').GameObjects.Container;
    parts!: Record<string, any>;
    prop!: import('phaser').GameObjects.Container;
    bubble!: import('phaser').GameObjects.Container;
    bubbleText!: import('phaser').GameObjects.Text;
    zzz!: import('phaser').GameObjects.Text;
    sprite: import('phaser').GameObjects.Sprite | null = null;
    lastSkyKey = '';
    nextBlink = 0;
    blinkUntil = 0;
    camX = 2400;

    constructor() {
      super('island');
    }

    preload() {
      for (const [id, a] of Object.entries(manifest.character.animations)) {
        this.load.spritesheet(`char_${id}`, a.url, { frameWidth: a.frameWidth, frameHeight: a.frameHeight });
      }
      for (const [kind, a] of Object.entries(manifest.objects)) this.load.image(`obj_${kind}`, a.url);
      if (manifest.character.image) this.load.image('char_image', manifest.character.image.url);
    }

    create() {
      for (const [id, a] of Object.entries(manifest.character.animations)) {
        this.anims.create({ key: `anim_${id}`, frames: this.anims.generateFrameNumbers(`char_${id}`, { start: 0, end: a.frames - 1 }), frameRate: a.frameRate, repeat: a.loop === false ? 0 : -1 });
      }
      this.cameras.main.setBounds(0, 0, WORLD_PX, H);
      this.sky = this.add.graphics().setScrollFactor(0).setDepth(-100);
      this.stars = this.add.graphics().setScrollFactor(0).setDepth(-99);
      this.drawStars();
      this.celestial = this.add.graphics().setScrollFactor(0).setDepth(-98);
      for (let i = 0; i < 6; i++) {
        const g = this.add.graphics().setScrollFactor(0.15).setDepth(-90);
        this.drawCloud(g, 0.7 + (i % 3) * 0.25);
        this.clouds.push({ g, x: i * 900 + 100, y: 70 + (i % 3) * 45, speed: 4 + (i % 3) * 3 });
      }
      this.drawBackdrop();
      this.drawTerrain();
      this.drawHouse();
      this.makeCharacter();
      this.nightOverlay = this.add.rectangle(0, 0, W, H, 0x0b1430, 0).setOrigin(0).setScrollFactor(0).setDepth(50);
      this.glows = this.add.graphics().setDepth(51).setBlendMode(Phaser.BlendModes.ADD);
      this.rain = this.add.graphics().setScrollFactor(0).setDepth(52);
      for (let i = 0; i < 90; i++) this.rainDrops.push({ x: Math.random() * W, y: Math.random() * H, v: 260 + Math.random() * 140 });
      if (manifest.character.placeholder) {
        this.add
          .text(W / 2, H - 96, manifest.character.label, { fontFamily: 'DM Sans, sans-serif', fontSize: '15px', color: '#5d6574', backgroundColor: 'rgba(255,253,248,0.82)', padding: { x: 8, y: 4 } })
          .setOrigin(0.5, 1)
          .setAlpha(0.8)
          .setScrollFactor(0)
          .setDepth(100);
      }
    }

    // ------------------------------------------------------------ static art --
    drawStars() {
      const g = this.stars;
      const rnd = (n: number) => {
        const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return v - Math.floor(v);
      };
      for (let i = 0; i < 90; i++) {
        const x = rnd(i * 3 + 1) * W;
        const y = rnd(i * 3 + 2) * 320;
        g.fillStyle(0xffffff, 0.45 + rnd(i * 7 + 5) * 0.55);
        g.fillCircle(x, y, rnd(i * 5 + 3) < 0.85 ? 1.3 : 2.2);
      }
    }

    drawCloud(g: import('phaser').GameObjects.Graphics, s: number) {
      g.fillStyle(0xffffff, 0.85);
      g.fillEllipse(0, 0, 160 * s, 46 * s);
      g.fillEllipse(-40 * s, -14 * s, 80 * s, 50 * s);
      g.fillEllipse(30 * s, -20 * s, 90 * s, 60 * s);
    }

    drawBackdrop() {
      const far = this.add.graphics().setScrollFactor(0.25).setDepth(-80);
      far.fillStyle(0xb9cfb2, 1);
      for (let i = -1; i < 12; i++) far.fillEllipse(i * 420 + 120, GROUND - 40, 620, 260);
      const near = this.add.graphics().setScrollFactor(0.5).setDepth(-70);
      near.fillStyle(0xa6c79a, 1);
      for (let i = -1; i < 16; i++) near.fillEllipse(i * 360, GROUND - 10, 520, 170);
    }

    drawTerrain() {
      const g = this.add.graphics().setDepth(-50);
      // ground
      g.fillStyle(C.grass, 1);
      g.fillRect(0, GROUND, WORLD_PX, H - GROUND);
      g.fillStyle(C.grassDark, 1);
      g.fillRect(0, GROUND + 90, WORLD_PX, H - GROUND - 90);
      // forest floor
      g.fillStyle(0x86ad83, 1);
      g.fillRect(0, GROUND, LOCATIONS.forest.x1 * S, H - GROUND);
      // path
      g.fillStyle(0xe6d7b8, 1);
      g.fillRoundedRect(LOCATIONS.forest.x0 * S + 40, GROUND + 20, (LOCATIONS.pond.x0 - LOCATIONS.forest.x0) * S, 26, 13);
      // garden beds
      g.fillStyle(C.soil, 1);
      g.fillRoundedRect(320 * S, GROUND + 4, 145 * S, 22, 10);
      g.fillStyle(0x94704f, 1);
      for (let x = 325 * S; x < 462 * S; x += 28) g.fillRect(x, GROUND + 12, 14, 3);
      // pond
      g.fillStyle(0x6aa1c8, 1);
      g.fillEllipse(860 * S, GROUND + 40, 210 * S, 150);
      g.fillStyle(C.water, 1);
      g.fillEllipse(860 * S, GROUND + 36, 200 * S, 130);
      g.fillStyle(0xa8cbe4, 0.8);
      for (let i = 0; i < 7; i++) g.fillEllipse((790 + i * 22) * S, GROUND + 24 + (i % 2) * 22, 60, 6);
      g.fillStyle(0x7fae78, 1);
      for (const [x, y] of [[820, 46], [880, 30], [940, 54]] as const) g.fillEllipse(x * S, GROUND + y, 44, 16);
      // forest backdrop trees (decor, not interactive)
      const t = this.add.graphics().setDepth(-45);
      for (let i = 0; i < 9; i++) {
        const x = (10 + i * 24) * S;
        const h = 220 + (i % 3) * 60;
        t.fillStyle(0x5d8a68, 1);
        t.fillTriangle(x - 70, GROUND - 10, x + 70, GROUND - 10, x, GROUND - h);
        t.fillStyle(0x6c9a74, 1);
        t.fillTriangle(x - 52, GROUND - h * 0.45, x + 52, GROUND - h * 0.45, x, GROUND - h - 20);
        t.fillStyle(0x7b5a43, 1);
        t.fillRect(x - 8, GROUND - 14, 16, 18);
      }
      // location labels
      for (const l of Object.values(LOCATIONS)) {
        if (l.id === 'bedroom' || l.id === 'home') continue;
        this.add
          .text(((l.x0 + l.x1) / 2) * S, GROUND + 112, l.name.toUpperCase(), { fontFamily: 'DM Sans, sans-serif', fontSize: '16px', color: '#ffffff', letterSpacing: 3 } as any)
          .setOrigin(0.5)
          .setAlpha(0.75)
          .setDepth(-40);
      }
    }

    drawHouse() {
      const x0 = LOCATIONS.home.x0 * S + 8;
      const x1 = LOCATIONS.bedroom.x1 * S - 8;
      const mid = LOCATIONS.bedroom.x0 * S;
      const top = GROUND - 300;
      const g = this.add.graphics().setDepth(-30);
      // back wall (cut-away dollhouse)
      g.fillStyle(C.wall, 1);
      g.fillRoundedRect(x0, top, x1 - x0, GROUND - top, { tl: 28, tr: 28, bl: 0, br: 0 });
      g.fillStyle(0xead9bd, 1);
      g.fillRect(x0, GROUND - 40, x1 - x0, 40);
      // wallpaper dots
      g.fillStyle(C.wallDark, 1);
      for (let x = x0 + 30; x < x1 - 20; x += 46) for (let y = top + 60; y < GROUND - 60; y += 46) g.fillCircle(x, y, 3);
      // floor
      g.fillStyle(0xc9a27c, 1);
      g.fillRect(x0, GROUND - 6, x1 - x0, 14);
      // divider with doorway
      g.fillStyle(0xd9c4a3, 1);
      g.fillRect(mid - 9, top + 10, 18, GROUND - top - 140);
      // round window in bedroom
      g.fillStyle(0xd9c4a3, 1);
      g.fillCircle((mid + x1) / 2, top + 110, 54);
      g.fillStyle(0xbcd6ea, 1);
      g.fillCircle((mid + x1) / 2, top + 110, 44);
      // living room window
      g.fillStyle(0xd9c4a3, 1);
      g.fillRoundedRect(x0 + 230, top + 60, 150, 110, 18);
      g.fillStyle(0xbcd6ea, 1);
      g.fillRoundedRect(x0 + 240, top + 70, 130, 90, 14);
      // roof
      const r = this.add.graphics().setDepth(-29);
      r.fillStyle(C.roof, 1);
      r.fillTriangle(x0 - 40, top + 14, x1 + 40, top + 14, (x0 + x1) / 2, top - 130);
      r.fillStyle(0xb36c56, 1);
      r.fillRect(x0 - 40, top + 4, x1 - x0 + 80, 16);
      // chimney
      r.fillStyle(0xa86753, 1);
      r.fillRect(x0 + 120, top - 100, 40, 80);
      // window glow layer coordinates for night
      (this as any).windowGlows = [
        [(mid + x1) / 2, top + 110, 60],
        [x0 + 305, top + 115, 90],
      ];
    }

    // ------------------------------------------------------------ character --
    makeCharacter() {
      const c = this.add.container(2400, GROUND).setDepth(10).setScale(CHAR_SCALE);
      const shadow = this.add.ellipse(0, 2, 84, 16, 0x2e3644, 0.14);
      const feetL = this.add.ellipse(-18, -4, 26, 14, C.bodyShade);
      const feetR = this.add.ellipse(18, -4, 26, 14, C.bodyShade);
      const body = this.add.container(0, 0);
      const torso = this.add.ellipse(0, -52, 92, 100, C.body);
      const belly = this.add.ellipse(0, -40, 58, 56, C.belly);
      const armL = this.add.ellipse(-44, -48, 20, 34, C.bodyShade);
      const armR = this.add.ellipse(44, -48, 20, 34, C.bodyShade);
      const eyes = this.add.container(0, -66);
      const eyeL = this.add.ellipse(-15, 0, 10, 14, C.eye);
      const eyeR = this.add.ellipse(15, 0, 10, 14, C.eye);
      const glintL = this.add.circle(-13, -3, 2.4, 0xffffff);
      const glintR = this.add.circle(17, -3, 2.4, 0xffffff);
      eyes.add([eyeL, eyeR, glintL, glintR]);
      const blushL = this.add.ellipse(-27, -54, 14, 7, C.blush, 0.8);
      const blushR = this.add.ellipse(27, -54, 14, 7, C.blush, 0.8);
      const mouth = this.add.graphics();
      mouth.lineStyle(2.5, C.eye, 1);
      mouth.beginPath();
      mouth.arc(0, -56, 6, 0.2, Math.PI - 0.2);
      mouth.strokePath();
      const closedEyes = this.add.graphics();
      closedEyes.lineStyle(3, C.eye, 1);
      closedEyes.beginPath();
      closedEyes.arc(-15, -68, 6, 0.2, Math.PI - 0.2);
      closedEyes.strokePath();
      closedEyes.beginPath();
      closedEyes.arc(15, -68, 6, 0.2, Math.PI - 0.2);
      closedEyes.strokePath();
      closedEyes.setVisible(false);
      body.add([armL, armR, torso, belly, blushL, blushR, eyes, closedEyes, mouth]);
      this.prop = this.add.container(0, 0);
      c.add([shadow, feetL, feetR, body, this.prop]);
      this.char = c;
      this.parts = { shadow, feetL, feetR, body, torso, armL, armR, eyes, closedEyes, mouth };
      // official character art: one still, animated with gentle transforms and drawn eyelids
      const img = manifest.character.image;
      if (img && this.textures.exists('char_image')) {
        for (const g of [torso, belly, armL, armR, eyes, blushL, blushR, mouth, closedEyes, feetL, feetR]) (g as any).setVisible(false);
        const k = img.displayHeight / img.height;
        const sprite = this.add.image(0, 2, 'char_image').setOrigin(0.5, 1).setScale(k);
        const lidColor = parseInt(img.lidColor.slice(1), 16);
        const lids = img.eyes.map((e) => {
          const cx = (e.x - img.width / 2) * k;
          const cy = (e.y - img.height) * k + 2;
          const lid = this.add.ellipse(cx, cy - e.ry * k, e.rx * 2 * k * 1.08, e.ry * 2 * k * 1.1, lidColor).setOrigin(0.5, 0).setScale(1, 0);
          const lash = this.add.graphics();
          lash.lineStyle(2.2, 0x1d3f66, 0.9);
          lash.beginPath();
          lash.arc(cx, cy - 2, e.rx * k * 0.75, 0.25, Math.PI - 0.25);
          lash.strokePath();
          lash.setVisible(false);
          return { lid, lash };
        });
        body.add([sprite, ...lids.flatMap((l) => [l.lid, l.lash])]);
        this.parts.image = { sprite, lids };
        shadow.setSize(96, 16);
      }
      this.zzz = this.add.text(0, 0, 'z z z', { fontFamily: 'Fraunces, serif', fontSize: '26px', color: '#5b8db8' }).setDepth(12).setVisible(false);
      const bubbleBg = this.add.graphics();
      this.bubbleText = this.add.text(0, 0, '', { fontFamily: 'DM Sans, sans-serif', fontSize: '18px', color: '#2e3644', align: 'center', wordWrap: { width: 260 } }).setOrigin(0.5);
      this.bubble = this.add.container(0, 0, [bubbleBg, this.bubbleText]).setDepth(30).setVisible(false);
      (this.bubble as any).bg = bubbleBg;
    }

    setBubble(text: string | null) {
      if (!text) {
        this.bubble.setVisible(false);
        return;
      }
      if (this.bubbleText.text !== text) {
        this.bubbleText.setText(text);
        const bg = (this.bubble as any).bg as import('phaser').GameObjects.Graphics;
        const w = Math.max(48, this.bubbleText.width + 28);
        const h = this.bubbleText.height + 18;
        bg.clear();
        bg.fillStyle(0xfffdf8, 0.97);
        bg.lineStyle(1.5, 0xe7dfd0, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
        bg.fillTriangle(-8, h / 2 - 1, 8, h / 2 - 1, 0, h / 2 + 10);
      }
      this.bubble.setVisible(true);
    }

    setProp(kind: string | null, held: WorldObject | null) {
      const key = `${kind}|${held?.kind ?? ''}`;
      if ((this.prop as any).key === key) return;
      (this.prop as any).key = key;
      this.prop.removeAll(true);
      const g = this.add.graphics();
      this.prop.add(g);
      const draw = (k: string) => drawProp(this, g, k);
      if (kind) draw(kind);
      else if (held) {
        const c = this.add.container(0, -112);
        drawObjectInto(this, c, held, true);
        this.prop.add(c);
      }
    }

    poseCharacter(anim: AnimationId, t: number, progress: number, facing: number, awake: boolean, held: WorldObject | null) {
      const p = this.parts;
      const body = p.body as import('phaser').GameObjects.Container;
      // reset
      body.setPosition(0, 0).setRotation(0).setScale(1, 1);
      p.armL.setPosition(-44, -48).setRotation(0);
      p.armR.setPosition(44, -48).setRotation(0);
      p.feetL.setPosition(-18, -4);
      p.feetR.setPosition(18, -4);
      p.shadow.setScale(1);
      this.prop.setPosition(0, 0).setRotation(0);
      const breathe = Math.sin(t / 900) * 0.02;
      let squash = 1 + breathe;
      let bubble: string | null = null;
      let prop: string | null = null;
      this.zzz.setVisible(false);
      this.char.scaleY = CHAR_SCALE;
      const sleeping = !awake || anim === 'sleeping';
      p.closedEyes.setVisible(sleeping);
      p.eyes.setVisible(!sleeping);
      // blinking (ambient layer)
      if (t > this.nextBlink) {
        this.blinkUntil = t + 130;
        this.nextBlink = t + 2600 + Math.random() * 2600;
      }
      p.eyes.setScale(1, t < this.blinkUntil ? 0.12 : 1);
      // gaze
      p.eyes.x = 0;

      switch (anim) {
        case 'walking':
        case 'carrying': {
          const ph = t / 150;
          body.y = -Math.abs(Math.sin(ph)) * 4;
          body.rotation = Math.sin(ph) * 0.04;
          p.feetL.y = -4 - Math.max(0, Math.sin(ph)) * 8;
          p.feetR.y = -4 - Math.max(0, -Math.sin(ph)) * 8;
          p.armL.rotation = Math.sin(ph) * 0.4;
          p.armR.rotation = -Math.sin(ph) * 0.4;
          if (anim === 'carrying' || held) {
            p.armL.setPosition(-30, -70).setRotation(-0.6);
            p.armR.setPosition(30, -70).setRotation(0.6);
          }
          break;
        }
        case 'sleeping':
          body.rotation = -Math.PI / 2;
          body.setPosition(0, 0);
          squash = 1 + Math.sin(t / 900) * 0.03;
          this.zzz.setVisible(true);
          this.zzz.setPosition(this.char.x - 110, this.char.y - 90 - ((t / 40) % 30));
          this.zzz.setAlpha(0.5 + Math.sin(t / 600) * 0.3);
          p.feetL.setVisible(false);
          p.feetR.setVisible(false);
          break;
        case 'sitting':
        case 'resting':
        case 'watching_sunset':
          body.y = 10;
          squash = 0.94 + breathe;
          p.feetL.setPosition(-26, -2);
          p.feetR.setPosition(26, -2);
          if (anim === 'watching_sunset') body.rotation = Math.sin(t / 1400) * 0.03;
          break;
        case 'reading':
          body.y = 10;
          squash = 0.94 + breathe;
          prop = 'book';
          p.armL.setPosition(-26, -32).setRotation(-0.9);
          p.armR.setPosition(26, -32).setRotation(0.9);
          p.eyes.y = -60;
          if (Math.floor(t / 4200) % 2 === 0 && (t % 4200) < 300) prop = 'book_turn';
          break;
        case 'drinking_tea': {
          body.y = 8;
          const sip = (t % 3000) / 3000;
          prop = 'cup';
          p.armR.setPosition(30, sip < 0.3 ? -66 : -48).setRotation(0.8);
          this.prop.setPosition(sip < 0.3 ? -6 : 0, sip < 0.3 ? -16 : 0);
          break;
        }
        case 'eating': {
          const bite = Math.sin(t / 220);
          prop = 'apple';
          p.armR.setPosition(26, -60 + bite * 5).setRotation(0.9);
          body.y = Math.max(0, bite) * 2;
          break;
        }
        case 'gardening': {
          const dig = Math.sin(t / 260);
          body.rotation = 0.25 * facing;
          body.y = 6;
          p.armR.setPosition(40, -24 + dig * 6).setRotation(0.5);
          prop = 'trowel';
          this.prop.setPosition(0, dig * 4);
          break;
        }
        case 'watering': {
          prop = 'watering_can';
          p.armR.setPosition(40, -56).setRotation(-0.3);
          this.prop.setRotation(0.25 + Math.sin(t / 500) * 0.06);
          break;
        }
        case 'painting': {
          prop = 'easel';
          const stroke = Math.sin(t / 300);
          p.armR.setPosition(48 + stroke * 6, -70 + Math.cos(t / 300) * 6).setRotation(-0.8);
          break;
        }
        case 'fishing': {
          prop = 'rod';
          body.y = 8;
          this.prop.setRotation(Math.sin(t / 900) * 0.04);
          break;
        }
        case 'dancing': {
          const ph = t / 320;
          body.y = -Math.abs(Math.sin(ph)) * 8;
          body.rotation = Math.sin(ph / 2) * 0.12;
          p.armL.setPosition(-46, -80).setRotation(-2.2 + Math.sin(ph) * 0.4);
          p.armR.setPosition(46, -80).setRotation(2.2 - Math.sin(ph) * 0.4);
          p.shadow.setScale(1 - Math.abs(Math.sin(ph)) * 0.25);
          break;
        }
        case 'looking_around':
          p.eyes.x = Math.sin(t / 900) * 6;
          body.rotation = Math.sin(t / 1300) * 0.05;
          break;
        case 'inspecting':
        case 'react_curious':
          body.rotation = 0.18 * facing;
          body.y = -2;
          bubble = '?';
          p.eyes.setScale(1.15, t < this.blinkUntil ? 0.12 : 1.15);
          break;
        case 'react_surprised':
          body.y = -Math.abs(Math.sin(t / 260)) * 6;
          bubble = '✦';
          p.armL.setPosition(-48, -72).setRotation(-1.2);
          p.armR.setPosition(48, -72).setRotation(1.2);
          break;
        case 'react_happy':
          body.y = -Math.abs(Math.sin(t / 300)) * 5;
          bubble = '♡';
          break;
        case 'stretching':
        case 'waking_up': {
          const st = (Math.sin(t / 600) + 1) / 2;
          squash = 1 + st * 0.12;
          p.armL.setPosition(-36, -96 - st * 10).setRotation(-2.6);
          p.armR.setPosition(36, -96 - st * 10).setRotation(2.6);
          break;
        }
        case 'hugging':
          prop = 'teddy';
          p.armL.setPosition(-20, -46).setRotation(-1.2);
          p.armR.setPosition(20, -46).setRotation(1.2);
          body.rotation = Math.sin(t / 700) * 0.06;
          break;
        case 'playing':
          prop = 'top';
          body.y = -Math.abs(Math.sin(t / 380)) * 4;
          this.prop.setRotation(0);
          break;
        case 'photographing':
          prop = 'camera';
          p.armL.setPosition(-20, -64).setRotation(-1);
          p.armR.setPosition(20, -64).setRotation(1);
          break;
        case 'waving': {
          p.armR.setPosition(46, -82).setRotation(2.4 + Math.sin(t / 260) * 0.4);
          body.rotation = Math.sin(t / 520) * 0.06;
          bubble = '♡';
          break;
        }
        case 'picking_up':
          body.rotation = 0.3 * facing;
          body.y = 8;
          p.armR.setPosition(40, -20).setRotation(0.4);
          break;
        default:
          break;
      }
      if (!sleeping) {
        p.feetL.setVisible(true);
        p.feetR.setVisible(true);
      }
      if (p.image) {
        this.prop.y += 10;
        // procedural parts stay hidden; blink and sleep with soft eyelids instead
        for (const g of [p.torso, p.armL, p.armR, p.eyes, p.closedEyes, p.mouth, p.feetL, p.feetR]) g.setVisible(false);
        const closed = sleeping ? 1 : t < this.blinkUntil ? 1 : anim === 'resting' || anim === 'watching_sunset' ? 0.42 : 0;
        for (const l of p.image.lids) {
          l.lid.scaleY += (closed - l.lid.scaleY) * 0.35;
          l.lash.setVisible(l.lid.scaleY > 0.9);
        }
      }
      body.scaleY = squash;
      body.scaleX = 2 - squash;
      this.char.scaleX = facing * CHAR_SCALE;
      // the bubble must not mirror
      this.setProp(prop, prop ? null : held);
      return bubble;
    }

    // ---------------------------------------------------------------- update --
    update(time: number, delta: number) {
      const inp = read();
      if (!inp) return;
      const { frame, objects, minute, characterX, animation } = inp;
      this.updateSky(minute, frame.weather);
      this.syncObjects(objects, minute);

      // character placement
      const px = characterX * S;
      let y = GROUND;
      const act = frame.character.activity;
      const target = act?.targetId ? objects[act.targetId] : undefined;
      let px2 = px;
      if (animation.animation === 'sleeping' && target?.kind === 'bed') {
        // lie down on the mattress: the body rotates around the feet
        px2 = target.x * S + (p_image(this) ? 80 : 62);
        y = GROUND - 52;
      } else if (['resting', 'reading', 'sitting', 'drinking_tea'].includes(animation.animation) && target && ['armchair', 'bench', 'bed', 'treehouse', 'jetty'].includes(target.kind)) {
        y = GROUND - (target.kind === 'bed' ? 38 : target.kind === 'treehouse' ? 120 : 24);
      } else if (animation.animation === 'fishing' || (target?.kind === 'jetty' && animation.animation !== 'walking')) {
        y = GROUND - 8;
      }
      const facing = animation.animation === 'sleeping' ? 1 : frame.character.facing;
      this.char.setPosition(px2, y);
      const held = frame.character.heldObjectId && frame.character.awake ? objects[frame.character.heldObjectId] ?? null : null;
      const bubble = this.poseCharacter(animation.animation, time, animation.progress, facing, frame.character.awake, held);
      const thought = act?.thought && animation.stage === 'loop' && animation.progress < 0.5 ? act.thought : null;
      this.setBubble(bubble ?? thought);
      this.bubble.setPosition(px2 + 50, y - 190);

      // camera follows Calmling softly
      const desired = Math.max(W / 2, Math.min(WORLD_PX - W / 2, px));
      this.camX += (desired - this.camX) * Math.min(1, delta / 600);
      if (Math.abs(desired - this.camX) > W * 1.5) this.camX = desired;
      this.cameras.main.scrollX = this.camX - W / 2;

      // clouds
      for (const cl of this.clouds) {
        cl.x += (cl.speed * delta) / 1000;
        if (cl.x > WORLD_PX * 0.15 + W + 200) cl.x = -200;
        cl.g.setPosition(cl.x, cl.y);
      }
      // rain
      this.rain.clear();
      if (frame.weather === 'rain') {
        this.rain.lineStyle(1.2, 0xc8d8ea, 0.35);
        for (const d of this.rainDrops) {
          d.y += (d.v * delta) / 1000;
          d.x -= (30 * delta) / 1000;
          if (d.y > H) {
            d.y = -10;
            d.x = Math.random() * W;
          }
          this.rain.lineBetween(d.x, d.y, d.x - 2, d.y + 10);
        }
      }
    }

    updateSky(minute: number, weather: string) {
      const light = daylight(minute);
      const sunset = isSunset(minute) || (minuteOfDay(minute) > 300 && minuteOfDay(minute) < 450);
      const key = `${Math.round(light * 50)}|${sunset}|${weather}|${Math.floor(minuteOfDay(minute) / 4)}`;
      if (key === this.lastSkyKey) return;
      this.lastSkyKey = key;
      const night = 1 - light;
      let top = lerpColor(C.skyDayTop, C.skyNightTop, night);
      let bottom = lerpColor(C.skyDayBottom, C.skyNightBottom, night);
      if (sunset && light > 0.05) {
        const k = 0.65 * Math.min(1, light * 1.5);
        top = lerpColor(top, C.skyDuskTop, k);
        bottom = lerpColor(bottom, C.skyDuskBottom, k);
      }
      if (weather === 'rain' || weather === 'cloudy') {
        top = lerpColor(top, 0x8792a3, weather === 'rain' ? 0.5 : 0.3);
        bottom = lerpColor(bottom, 0xc7cbd2, weather === 'rain' ? 0.45 : 0.25);
      }
      this.sky.clear();
      this.sky.fillGradientStyle(top, top, bottom, bottom, 1);
      this.sky.fillRect(0, 0, W, H);
      this.stars.setAlpha(Math.max(0, night - 0.3) * 1.4 * (weather === 'clear' ? 1 : 0.3));
      // sun and moon travel across the sky
      const m = minuteOfDay(minute);
      this.celestial.clear();
      const sunT = (m - 330) / (1290 - 330);
      if (sunT > 0 && sunT < 1) {
        const x = 80 + sunT * (W - 160);
        const yv = 420 - Math.sin(sunT * Math.PI) * 330;
        this.celestial.fillStyle(sunset ? 0xf6b07c : 0xffe7a3, 0.35);
        this.celestial.fillCircle(x, yv, 58);
        this.celestial.fillStyle(sunset ? 0xf39a6a : 0xffd97a, 1);
        this.celestial.fillCircle(x, yv, 36);
      } else {
        const mt = ((m + 1440 - 1290) % 1440) / (1440 - (1290 - 330));
        const x = 80 + Math.min(1, mt) * (W - 160);
        const yv = 420 - Math.sin(Math.min(1, mt) * Math.PI) * 300;
        this.celestial.fillStyle(0xf3f1e6, 1);
        this.celestial.fillCircle(x, yv, 24);
        this.celestial.fillStyle(lerpColor(C.skyNightTop, C.skyNightBottom, 0.5), 1);
        this.celestial.fillCircle(x + 10, yv - 6, 20);
      }
      this.nightOverlay.setAlpha(night * 0.5);
      // warm window glow and object glows at night
      this.glows.clear();
      if (night > 0.3) {
        for (const [gx, gy, r] of ((this as any).windowGlows ?? []) as [number, number, number][]) {
          this.glows.fillStyle(0xffc878, 0.06 * night);
          this.glows.fillCircle(gx, gy, r * 1.25);
          this.glows.fillStyle(0xffd99a, 0.1 * night);
          this.glows.fillCircle(gx, gy, r * 0.85);
        }
      }
    }

    syncObjects(objects: Record<string, WorldObject>, minute: number) {
      const seen = new Set<string>();
      for (const o of Object.values(objects)) {
        if (o.heldBy) continue;
        if (o.origin.type === 'discovery' && !o.discovered) continue; // not visible until found
        seen.add(o.id);
        const sig = `${o.kind}|${o.name}|${o.location}|${Math.round(o.x)}|${o.discovered}|${Math.round((o.state.growth ?? 0) / 10)}|${o.state.fruit ?? ''}|${o.state.wilting ?? ''}|${o.state.planted ?? ''}`;
        const v = this.objectViews.get(o.id);
        if (v && v.sig === sig) continue;
        v?.c.destroy();
        const c = this.add.container(o.x * S, objectY(o)).setDepth(depthFor(o));
        drawObjectInto(this, c, o, false);
        if (!o.discovered && (o.origin.type === 'gift' || o.origin.type === 'poll' || o.origin.type === 'community_goal')) {
          const sp = this.add.text(18, -60, '✦', { fontSize: '20px', color: '#a597cf' }).setOrigin(0.5);
          c.add(sp);
          this.tweens.add({ targets: sp, alpha: 0.2, y: -70, duration: 900, yoyo: true, repeat: -1 });
        }
        this.objectViews.set(o.id, { c, sig });
      }
      for (const [id, v] of this.objectViews) {
        if (!seen.has(id)) {
          v.c.destroy();
          this.objectViews.delete(id);
        }
      }
      void minute;
    }
  };
}

function objectY(o: WorldObject): number {
  if (['painting', 'sketch', 'photo'].includes(o.kind) && (o.location === 'home' || o.location === 'bedroom')) return GROUND - 170;
  if (o.kind === 'jetty') return GROUND + 10;
  return GROUND;
}

function depthFor(o: WorldObject): number {
  if (['apple_tree', 'pine', 'shed', 'treehouse', 'bookshelf', 'pantry'].includes(o.kind)) return -20;
  if (['painting', 'sketch', 'photo'].includes(o.kind)) return -25;
  if (['bed', 'armchair', 'bench', 'jetty', 'bridge', 'flower_meadow', 'piano', 'telescope'].includes(o.kind)) return -10;
  return 5;
}

type Scene = import('phaser').Scene;
type G = import('phaser').GameObjects.Graphics;

/** Vector art for world objects; uses manifest images when official assets are provided. */
function drawObjectInto(scene: Scene, c: import('phaser').GameObjects.Container, o: WorldObject, small: boolean) {
  if (scene.textures.exists(`obj_${o.kind}`)) {
    c.add(scene.add.image(0, 0, `obj_${o.kind}`).setOrigin(0.5, 1));
    return;
  }
  const g = scene.add.graphics();
  c.add(g);
  const s = small ? 0.7 : 1;
  g.setScale(s);
  const wilt = o.state.wilting ? 0.4 : 0;
  switch (o.kind) {
    case 'bed':
      g.fillStyle(C.woodDark, 1).fillRoundedRect(-90, -64, 14, 64, 4).fillRoundedRect(76, -44, 14, 44, 4);
      g.fillStyle(0xf7f2e8, 1).fillRoundedRect(-80, -50, 156, 26, 10);
      g.fillStyle(0x9db7d6, 1).fillRoundedRect(-40, -52, 116, 30, 10);
      g.fillStyle(0xb7a9d9, 1);
      for (let i = 0; i < 4; i++) g.fillRect(-30 + i * 26, -50, 12, 26);
      g.fillStyle(0xffffff, 1).fillRoundedRect(-76, -60, 40, 18, 8);
      break;
    case 'armchair':
      g.fillStyle(0x8fb3a0, 1).fillRoundedRect(-40, -86, 80, 70, 18);
      g.fillStyle(0x7ea38f, 1).fillRoundedRect(-52, -50, 22, 46, 10).fillRoundedRect(30, -50, 22, 46, 10);
      g.fillStyle(0xa6c4b3, 1).fillRoundedRect(-32, -36, 64, 22, 8);
      g.fillStyle(C.woodDark, 1).fillRect(-40, -12, 8, 12).fillRect(32, -12, 8, 12);
      break;
    case 'kettle':
      g.fillStyle(0xd9c4a3, 1).fillRect(-40, -70, 80, 70);
      g.fillStyle(0xc98a5b, 1).fillEllipse(0, -86, 40, 30);
      g.lineStyle(4, 0xa86b44, 1).strokeEllipse(0, -100, 22, 14);
      break;
    case 'pantry':
      g.fillStyle(0xcfae86, 1).fillRoundedRect(-30, -150, 60, 150, 6);
      g.fillStyle(0xe6cfa9, 1);
      for (let i = 0; i < 3; i++) g.fillRect(-24, -138 + i * 44, 48, 34);
      g.fillStyle(0xe9a58a, 1).fillCircle(-10, -112, 7).fillCircle(8, -114, 6);
      g.fillStyle(0xd8b65a, 1).fillRoundedRect(-14, -78, 12, 20, 3).fillRoundedRect(4, -76, 12, 18, 3);
      break;
    case 'bookshelf':
      g.fillStyle(0xb58a62, 1).fillRect(-50, -170, 100, 10).fillRect(-50, -110, 100, 10);
      g.fillStyle(0x5b8db8, 1).fillRect(-44, -196, 10, 26);
      g.fillStyle(0xa597cf, 1).fillRect(-32, -192, 10, 22);
      g.fillStyle(0x7ea67f, 1).fillRect(-20, -198, 12, 28);
      break;
    case 'bench':
      g.fillStyle(C.wood, 1).fillRoundedRect(-60, -36, 120, 12, 4).fillRoundedRect(-60, -62, 120, 10, 4);
      g.fillStyle(C.woodDark, 1).fillRect(-52, -26, 8, 26).fillRect(44, -26, 8, 26);
      break;
    case 'jetty':
      g.fillStyle(C.wood, 1).fillRect(-160, -18, 320, 16);
      g.fillStyle(C.woodDark, 1);
      for (let i = -150; i < 160; i += 40) g.fillRect(i, -2, 8, 30);
      break;
    case 'shed':
      g.fillStyle(0xa4b99a, 1).fillRect(-60, -120, 120, 120);
      g.fillStyle(0x7f6a57, 1).fillTriangle(-74, -116, 74, -116, 0, -170);
      g.fillStyle(0x6e8b66, 1).fillRoundedRect(-22, -80, 44, 80, 4);
      break;
    case 'apple_tree': {
      g.fillStyle(0x8b6648, 1).fillRoundedRect(-14, -150, 28, 150, 8);
      g.fillStyle(0x7fae78, 1).fillCircle(0, -200, 84).fillCircle(-60, -170, 54).fillCircle(60, -168, 56);
      g.fillStyle(0x93bf8a, 1).fillCircle(-20, -220, 44);
      g.fillStyle(0xe0605a, 1);
      const spots = [[-40, -180], [30, -210], [55, -160], [-10, -150], [-62, -150]];
      for (let i = 0; i < Math.min(5, o.state.fruit ?? 0); i++) g.fillCircle(spots[i][0], spots[i][1], 9);
      break;
    }
    case 'pine':
      g.fillStyle(0x6e5240, 1).fillRect(-12, -40, 24, 40);
      g.fillStyle(0x4f7d5c, 1).fillTriangle(-90, -30, 90, -30, 0, -260).fillStyle(0x5d8f69, 1).fillTriangle(-70, -120, 70, -120, 0, -300);
      break;
    case 'painting':
    case 'sketch':
    case 'photo': {
      const hue = [0x9fc4e4, 0xe9a58a, 0xa597cf, 0x9cc38f][Math.floor(hash01(o.id) * 4)];
      g.fillStyle(o.kind === 'photo' ? 0xffffff : 0xb58a62, 1).fillRect(-30, -24, 60, 48);
      g.fillStyle(o.kind === 'sketch' ? 0xf7f2e8 : hue, 1).fillRect(-24, -18, 48, 36);
      g.fillStyle(o.kind === 'sketch' ? 0x8a909b : 0xffffff, 0.8).fillCircle(-8, -4, 8).fillTriangle(-24, 18, 0, -4, 24, 18);
      break;
    }
    case 'sprout': {
      const h = 12 + (o.state.growth ?? 0) * 0.9;
      g.fillStyle(0x8a6c50, 1).fillEllipse(0, -2, 34, 10);
      g.lineStyle(4, 0x6f9e63, 1).lineBetween(0, -4, wilt * 10, -h);
      g.fillStyle(0x84b86f, 1).fillEllipse(-9, -h * 0.6, 16, 8).fillEllipse(9 + wilt * 6, -h * 0.75, 16, 8);
      if (o.state.mystery) g.fillStyle(0xb7a9d9, 1).fillCircle(wilt * 10, -h, 5);
      break;
    }
    case 'sunflower':
    case 'mystery_bloom': {
      const petal = o.kind === 'sunflower' ? 0xf2c14e : 0xb7a9d9;
      const center = o.kind === 'sunflower' ? 0x7b5a3a : 0xfff1c7;
      g.lineStyle(5, 0x6f9e63, 1).lineBetween(0, 0, wilt * 20, -100);
      g.fillStyle(0x84b86f, 1).fillEllipse(-12, -50, 24, 10).fillEllipse(12, -66, 24, 10);
      g.fillStyle(petal, 1);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.fillEllipse(wilt * 20 + Math.cos(a) * 16, -104 + Math.sin(a) * 16, 16, 16);
      }
      g.fillStyle(center, 1).fillCircle(wilt * 20, -104, 11);
      break;
    }
    case 'flower':
    case 'decorative_plant': {
      const planted = !!o.state.planted;
      if (!planted) g.fillStyle(0xd98f6e, 1).fillRoundedRect(-16, -26, 32, 26, 6).fillStyle(0xc77f5e, 1).fillRect(-18, -28, 36, 6);
      if (o.kind === 'flower') {
        g.lineStyle(3, 0x6f9e63, 1).lineBetween(0, -24, wilt * 12, -62);
        g.fillStyle(0xe9879a, 1);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          g.fillCircle(wilt * 12 + Math.cos(a) * 9, -66 + Math.sin(a) * 9, 8);
        }
        g.fillStyle(0xf6d36b, 1).fillCircle(wilt * 12, -66, 6);
        g.fillStyle(0x84b86f, 1).fillEllipse(-10, -40, 16, 7);
      } else {
        g.fillStyle(0x6fa66a, 1);
        for (let i = -3; i <= 3; i++) g.fillEllipse(i * 7, -48 + Math.abs(i) * 4, 10, 40);
      }
      break;
    }
    case 'teddy_bear':
      g.fillStyle(0xc49a6c, 1).fillCircle(0, -22, 18).fillCircle(0, -50, 15).fillCircle(-12, -62, 6).fillCircle(12, -62, 6);
      g.fillStyle(0xe8cfae, 1).fillCircle(0, -46, 6).fillEllipse(0, -20, 18, 14);
      g.fillStyle(C.eye, 1).fillCircle(-5, -53, 2).fillCircle(5, -53, 2);
      break;
    case 'book':
      g.fillStyle(o.name === 'Old atlas' ? 0x8f6b4a : 0x5b8db8, 1).fillRoundedRect(-18, -12, 36, 12, 2);
      g.fillStyle(0xfdf8ec, 1).fillRect(-16, -10, 32, 3);
      break;
    case 'sketchbook':
      g.fillStyle(0xa597cf, 1).fillRoundedRect(-16, -10, 32, 10, 2);
      break;
    case 'camera':
      g.fillStyle(0x3e4656, 1).fillRoundedRect(-18, -24, 36, 24, 5);
      g.fillStyle(0xdce8f3, 1).fillCircle(0, -12, 8);
      g.fillStyle(0xe9a58a, 1).fillRect(8, -28, 8, 5);
      break;
    case 'watering_can':
      g.fillStyle(0x8fa9bf, 1).fillRoundedRect(-18, -30, 36, 30, 6);
      g.lineStyle(5, 0x8fa9bf, 1).lineBetween(16, -22, 34, -36);
      g.lineStyle(4, 0x7a93aa, 1).strokeEllipse(-6, -36, 22, 14);
      break;
    case 'painting_set':
      g.lineStyle(5, C.wood, 1).lineBetween(-24, 0, 0, -110).lineBetween(24, 0, 0, -110).lineBetween(0, 0, 0, -100);
      g.fillStyle(0xfffdf8, 1).fillRect(-34, -96, 68, 52);
      g.fillStyle(0x9fc4e4, 1).fillCircle(-12, -74, 9).fillStyle(0xe9a58a, 1).fillCircle(10, -64, 7);
      break;
    case 'cup':
      g.fillStyle(0xe6d2b5, 1).fillRoundedRect(-10, -18, 20, 18, 4);
      g.lineStyle(3, 0xd2b893, 1).strokeCircle(12, -10, 5);
      break;
    case 'toy':
      g.fillStyle(0xe9a58a, 1).fillTriangle(-14, -22, 14, -22, 0, 0).fillStyle(0x5b8db8, 1).fillRect(-14, -28, 28, 6).fillStyle(0xb58a62, 1).fillRect(-2, -38, 4, 12);
      break;
    case 'seed':
    case 'mystery_seed':
      g.fillStyle(o.kind === 'seed' ? 0xf2c14e : 0xb7a9d9, 1).fillRoundedRect(-12, -26, 24, 26, 3);
      g.fillStyle(0xffffff, 0.8).fillCircle(0, -14, 5);
      break;
    case 'apple':
      g.fillStyle(0xe0605a, 1).fillCircle(0, -10, 10);
      break;
    case 'piano':
      g.fillStyle(0x5b4636, 1).fillRoundedRect(-60, -110, 120, 110, 8);
      g.fillStyle(0xfffdf8, 1).fillRect(-54, -60, 108, 16);
      g.fillStyle(0x2e3644, 1);
      for (let i = -50; i < 50; i += 14) g.fillRect(i + 8, -60, 6, 9);
      break;
    case 'telescope':
      g.lineStyle(4, 0x8a6446, 1).lineBetween(-20, 0, 0, -60).lineBetween(20, 0, 0, -60);
      g.fillStyle(0xc9a35b, 1).fillRoundedRect(-10, -96, 70, 18, 8);
      g.setRotation(-0.35);
      break;
    case 'treehouse':
      g.fillStyle(0x7b5a43, 1).fillRect(-20, -200, 40, 200);
      g.fillStyle(0x5d8a68, 1).fillCircle(0, -300, 110);
      g.fillStyle(C.wood, 1).fillRect(-90, -210, 180, 90);
      g.fillStyle(C.roof, 1).fillTriangle(-110, -206, 110, -206, 0, -280);
      g.fillStyle(0xffe2a8, 1).fillRect(-20, -186, 40, 40);
      g.lineStyle(4, C.woodDark, 1);
      for (let y = -110; y < 0; y += 22) g.lineBetween(40, y, 70, y);
      break;
    case 'bridge':
      g.fillStyle(C.wood, 1);
      g.fillRect(-140, -40, 280, 14);
      g.lineStyle(5, C.woodDark, 1).beginPath();
      g.arc(0, 140, 200, Math.PI * 1.32, Math.PI * 1.68).strokePath();
      for (let i = -130; i <= 130; i += 26) g.lineBetween(i, -40, i, -70);
      break;
    case 'flower_meadow':
      for (let i = 0; i < 70; i++) {
        const fx = (hash01(`m${i}`) - 0.5) * 340;
        const fy = -hash01(`n${i}`) * 26;
        g.fillStyle([0xe9879a, 0xf2c14e, 0xb7a9d9, 0xffffff][i % 4], 1).fillCircle(fx, fy - 8, 5);
      }
      break;
    case 'pinecone':
      g.fillStyle(0x8a6446, 1).fillEllipse(0, -10, 16, 22);
      break;
    case 'feather':
      g.fillStyle(0x5b8db8, 1).fillEllipse(0, -12, 8, 28);
      break;
    case 'pebble':
      g.fillStyle(0xb5bcc7, 1).fillEllipse(0, -6, 20, 12).fillStyle(0xffffff, 0.8).fillCircle(4, -9, 2);
      break;
    case 'mushroom':
      g.fillStyle(0xf7f2e8, 1).fillRect(-4, -14, 8, 14).fillStyle(0xe0605a, 1).fillEllipse(0, -16, 26, 14).fillStyle(0xffffff, 1).fillCircle(-5, -18, 2).fillCircle(5, -16, 2);
      break;
    case 'shell':
      g.fillStyle(0xe8cfae, 1).fillCircle(0, -10, 10).lineStyle(2, 0xc49a6c, 1).strokeCircle(0, -10, 5);
      break;
    case 'fishing_rod':
      g.lineStyle(3, 0xb58a62, 1).lineBetween(-30, -2, 30, -6);
      break;
    default:
      c.add(scene.add.text(0, -16, '🎁', { fontSize: '28px' }).setOrigin(0.5));
  }
}

function drawProp(scene: Scene, g: G, kind: string) {
  switch (kind) {
    case 'book':
    case 'book_turn':
      g.fillStyle(0x5b8db8, 1).fillRoundedRect(-26, -44, 52, 28, 4);
      g.fillStyle(0xfdf8ec, 1).fillRect(-22, -41, 20, 22).fillRect(2, -41, 20, 22);
      if (kind === 'book_turn') g.fillStyle(0xffffff, 1).fillTriangle(0, -41, 16, -47, 0, -19);
      break;
    case 'cup':
      g.fillStyle(0xe6d2b5, 1).fillRoundedRect(30, -78, 20, 18, 4);
      g.fillStyle(0xffffff, 0.6).fillCircle(40, -88, 4).fillCircle(44, -98, 3);
      break;
    case 'apple':
      g.fillStyle(0xe0605a, 1).fillCircle(32, -66, 10);
      break;
    case 'trowel':
      g.fillStyle(0x8fa9bf, 1).fillTriangle(48, -12, 60, -12, 54, 4);
      g.fillStyle(0x8a6446, 1).fillRect(51, -28, 6, 18);
      break;
    case 'watering_can':
      g.fillStyle(0x8fa9bf, 1).fillRoundedRect(42, -76, 34, 26, 6);
      g.lineStyle(5, 0x8fa9bf, 1).lineBetween(74, -68, 96, -80);
      g.fillStyle(0x9fc4e4, 0.9);
      for (let i = 0; i < 4; i++) g.fillCircle(98 + i * 3, -70 + i * 14, 3);
      break;
    case 'easel':
      g.lineStyle(5, C.wood, 1).lineBetween(70, 0, 96, -120).lineBetween(122, 0, 96, -120);
      g.fillStyle(0xfffdf8, 1).fillRect(62, -116, 70, 56);
      g.fillStyle(0x9fc4e4, 1).fillCircle(84, -94, 10).fillStyle(0xe9a58a, 1).fillCircle(106, -80, 8).fillStyle(0x9cc38f, 1).fillRect(70, -72, 54, 8);
      break;
    case 'rod':
      g.lineStyle(4, 0xb58a62, 1).lineBetween(30, -60, 150, -150);
      g.lineStyle(1.5, 0xffffff, 0.9).lineBetween(150, -150, 170, 30);
      g.fillStyle(0xe0605a, 1).fillCircle(170, 30, 5);
      break;
    case 'teddy':
      g.fillStyle(0xc49a6c, 1).fillCircle(0, -44, 16).fillCircle(0, -68, 12).fillCircle(-10, -78, 5).fillCircle(10, -78, 5);
      break;
    case 'top':
      g.fillStyle(0xe9a58a, 1).fillTriangle(50, -22, 78, -22, 64, 0).fillStyle(0x5b8db8, 1).fillRect(50, -28, 28, 6);
      break;
    case 'camera':
    case 'camera_flash':
      g.fillStyle(0x3e4656, 1).fillRoundedRect(-18, -84, 36, 24, 5).fillStyle(0xdce8f3, 1).fillCircle(0, -72, 8);
      if (kind === 'camera_flash') g.fillStyle(0xffffff, 0.9).fillCircle(0, -72, 28);
      break;
  }
  void scene;
}

function p_image(scene: unknown): boolean {
  return !!(scene as { parts?: { image?: unknown } }).parts?.image;
}
