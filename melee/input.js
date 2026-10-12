// Controller input for the web build: the keyboard (remappable) and
// browser gamepads, reported as GameCube controllers. Used by the page
// (index.html) as melee.readPad(port).

export const Buttons = {
  Left: 0x0001, Right: 0x0002, Down: 0x0004, Up: 0x0008,
  Z: 0x0010, R: 0x0020, L: 0x0040,
  A: 0x0100, B: 0x0200, X: 0x0400, Y: 0x0800, Start: 0x1000,
};

// The keyboard's default layout. Actions: buttons, the control stick
// (stick*), the C-stick (cstick*) and a modifier for half tilts.
export const DefaultKeys = {
  stickUp: 'KeyW', stickDown: 'KeyS', stickLeft: 'KeyA', stickRight: 'KeyD',
  tilt: 'ShiftLeft',
  cstickUp: 'ArrowUp', cstickDown: 'ArrowDown', cstickLeft: 'ArrowLeft', cstickRight: 'ArrowRight',
  A: 'KeyJ', B: 'KeyK', X: 'KeyL', Y: 'KeyI',
  Z: 'KeyP', L: 'KeyU', R: 'KeyO', Start: 'Enter',
  dUp: 'KeyT', dDown: 'KeyG', dLeft: 'KeyF', dRight: 'KeyH',
};

export const ActionNames = {
  stickUp: 'Stick up', stickDown: 'Stick down', stickLeft: 'Stick left', stickRight: 'Stick right',
  tilt: 'Tilt (half stick)',
  cstickUp: 'C-stick up', cstickDown: 'C-stick down', cstickLeft: 'C-stick left', cstickRight: 'C-stick right',
  A: 'A', B: 'B', X: 'X', Y: 'Y', Z: 'Z', L: 'L', R: 'R', Start: 'Start',
  dUp: 'D-pad up', dDown: 'D-pad down', dLeft: 'D-pad left', dRight: 'D-pad right',
};

const STICK_MAX = 100; // a GameCube stick at full tilt reports about this
const TILT = 0.5;
const DEADZONE = 0.15;

export class Input {
  constructor(target) {
    this.keys = { ...DefaultKeys };
    this.down = new Set();
    this.keyboardPort = 0;
    // While the settings are open the game sees no input
    this.paused = false;
    // Touch or other virtual controls write here (see touch.js)
    this.virtual = null;
    target.addEventListener('keydown', (e) => {
      if (this.paused) return;
      if (this.isBound(e.code)) {
        e.preventDefault();
      }
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  isBound(code) {
    return Object.values(this.keys).includes(code);
  }

  pressed(action) {
    return this.down.has(this.keys[action]);
  }

  keyboard() {
    let buttons = 0;
    for (const name of ['A', 'B', 'X', 'Y', 'Z', 'L', 'R', 'Start']) {
      if (this.pressed(name)) buttons |= Buttons[name];
    }
    if (this.pressed('dUp')) buttons |= Buttons.Up;
    if (this.pressed('dDown')) buttons |= Buttons.Down;
    if (this.pressed('dLeft')) buttons |= Buttons.Left;
    if (this.pressed('dRight')) buttons |= Buttons.Right;
    const scale = this.pressed('tilt') ? TILT : 1;
    const axis = (neg, pos) => ((this.pressed(pos) ? 1 : 0) - (this.pressed(neg) ? 1 : 0));
    return {
      buttons,
      sx: axis('stickLeft', 'stickRight') * scale,
      sy: axis('stickDown', 'stickUp') * scale,
      cx: axis('cstickLeft', 'cstickRight'),
      cy: axis('cstickDown', 'cstickUp'),
      l: this.pressed('L') ? 1 : 0,
      r: this.pressed('R') ? 1 : 0,
    };
  }

  // A browser gamepad in the standard layout (Xbox-style positions)
  static gamepad(pad) {
    const b = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
    const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : v);
    let buttons = 0;
    if (b(0) > 0.5) buttons |= Buttons.A;
    if (b(1) > 0.5) buttons |= Buttons.B;
    if (b(2) > 0.5) buttons |= Buttons.X;
    if (b(3) > 0.5) buttons |= Buttons.Y;
    if (b(5) > 0.5 || b(4) > 0.5) buttons |= Buttons.Z;
    if (b(9) > 0.5) buttons |= Buttons.Start;
    if (b(12) > 0.5) buttons |= Buttons.Up;
    if (b(13) > 0.5) buttons |= Buttons.Down;
    if (b(14) > 0.5) buttons |= Buttons.Left;
    if (b(15) > 0.5) buttons |= Buttons.Right;
    return {
      buttons,
      sx: dz(pad.axes[0] || 0), sy: -dz(pad.axes[1] || 0),
      cx: dz(pad.axes[2] || 0), cy: -dz(pad.axes[3] || 0),
      l: b(6), r: b(7),
    };
  }

  static report(s) {
    const stick = (v) => Math.max(-127, Math.min(127, Math.round(v * STICK_MAX)));
    let buttons = s.buttons;
    // Fully pressed triggers click, as the GameCube's do
    if (s.l > 0.95) buttons |= Buttons.L;
    if (s.r > 0.95) buttons |= Buttons.R;
    return {
      buttons,
      stickX: stick(s.sx), stickY: stick(s.sy),
      substickX: stick(s.cx), substickY: stick(s.cy),
      triggerL: Math.round(Math.min(1, s.l) * 255),
      triggerR: Math.round(Math.min(1, s.r) * 255),
    };
  }

  static merge(a, b) {
    const pick = (x, y) => (Math.abs(y) > Math.abs(x) ? y : x);
    return {
      buttons: a.buttons | b.buttons,
      sx: pick(a.sx, b.sx), sy: pick(a.sy, b.sy),
      cx: pick(a.cx, b.cx), cy: pick(a.cy, b.cy),
      l: Math.max(a.l, b.l), r: Math.max(a.r, b.r),
    };
  }

  // Port 1 is the keyboard (and touch controls) plus the first gamepad;
  // further gamepads take ports 2-4
  read(port) {
    const pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter((p) => p && p.connected);
    if (this.paused) {
      // Controllers stay plugged in, with nothing pressed
      const idle = { buttons: 0, sx: 0, sy: 0, cx: 0, cy: 0, l: 0, r: 0 };
      return port === this.keyboardPort || pads[port] ? Input.report(idle) : null;
    }
    if (port === this.keyboardPort) {
      let s = this.keyboard();
      if (this.virtual) s = Input.merge(s, this.virtual);
      if (pads[0]) s = Input.merge(s, Input.gamepad(pads[0]));
      return Input.report(s);
    }
    const pad = pads[port];
    return pad ? Input.report(Input.gamepad(pad)) : null;
  }

  rumble(port, on) {
    const pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter((p) => p && p.connected);
    const pad = pads[port];
    if (pad && pad.vibrationActuator && on) {
      pad.vibrationActuator.playEffect('dual-rumble', { duration: 100, strongMagnitude: 0.6, weakMagnitude: 0.3 })
        .catch(() => {});
    }
  }
}
