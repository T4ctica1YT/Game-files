# Melee for the web

A browser build of the Super Smash Bros. Melee decompilation. The game code
is compiled to WebAssembly, graphics go through WebGPU (via Aurora) and
audio through an AudioWorklet. No game data is included: you supply your
own disc image.

## Requirements

- A recent Chrome or Edge (version 137 or later) on desktop or Android.
  The build needs **WebGPU** and **WebAssembly JSPI**.
- A disc image of **Super Smash Bros. Melee NTSC 1.02 (GALE01, revision 2)**
  as a plain `.iso` or `.gcm`. A compressed `.rvz` must be converted first.
  In Dolphin, right-click the game, choose *Convert File…*, and set the
  format to ISO.

## Running

The files must be served over HTTP. Opening `index.html` straight from
disk doesn't work. The simplest way is the included server:

```
cd web
python serve.py
```

Then open <http://localhost:8080/>.

- **Disc in the folder.** Put your `.iso` or `.gcm` in this `web` folder
  (any name) and the page loads it by itself. With `serve.py` it's read in
  place. Another server works too if it supports range requests, or if the
  file is named `disc.iso`, `melee.iso` or `game.iso`. A server that sends
  only whole files (such as `python -m http.server`) makes the page copy
  the disc into the browser's storage once.
- **Split disc.** For hosts that limit file sizes (GitHub Pages allows
  100 MB per file), the image can be split into numbered parts in a
  `split` folder: `split/melee.iso.part01`, `part02`, and so on (plain byte
  splits, in order). The page downloads the parts and joins them back into
  the original image in the browser's storage before the game starts. The
  joined copy is kept, so later visits start at once unless the parts
  change. A split disc takes priority over a whole image in the folder.
- **Or choose it.** Otherwise press *Choose disc image…*. The disc is kept
  in the browser's private storage (OPFS), so you only choose it once.
  *Forget it* removes it.

Once the disc is ready, the settings open so you can adjust them before
pressing **Play**.

While playing, the **Settings** button at the top right (or Esc, when not
in fullscreen) opens the same settings over the game. Resolution, frame
rate, sound, reverb, the frame-rate display and the keyboard layout change
immediately. Anti-aliasing and texture filtering need a restart: press
*Restart now* and the page reloads straight back into the game. Saves are
kept, but anything unsaved, such as a match in progress, is lost.
## Settings

| Setting | What it does |
|---|---|
| Preset | **Low**, **Balanced** or **High**. The page picks one from the device on first visit. |
| Render scale | Internal resolution relative to the GameCube's 640×480. Use 0.75 on weak GPUs and 2 for sharp output. |
| Frame skip | 2 renders every other frame (30 fps on screen) while the game keeps full speed. It's the biggest saving on slow CPUs. |
| MSAA | 4× multisampling (GPU cost). |
| Anisotropic filtering | Sharper textures at angles (small GPU cost). |
| Audio | Turns the sound mixer off entirely when disabled (saves CPU). |
| Audio effects | Reverb and echo on the aux buses, as on the console. |
| Show FPS | Frame rate and main-thread load overlay. |

For low-end devices, start with the **Low** preset: 0.75 scale, frame skip
2 and no audio effects.

## Controls

Keyboard defaults (remappable in the settings):

| GameCube | Key |
|---|---|
| Control stick | W A S D (hold Shift to tilt) |
| C-stick | Arrow keys |
| A / B / X / Y | J / K / L / I |
| Z | P |
| L / R | U / O |
| Start | Enter |
| D-pad | T F G H |

Gamepads that use the browser's standard mapping work automatically.

## Files

- `index.html`, `app.js`: the start page and the settings.
- `serve.py`: a local server with range requests and disc discovery.
- `input.js`: keyboard and gamepad input.
- `audio-worklet.js`: audio output.
- `melee.js`, `melee.wasm`: the game.
- `test.html`: a development page that loads `disc.iso` from the server.

## Known limitations

- There is one memory card, in slot A, kept in this browser's storage
  (`card-a.bin` next to the disc). Clearing the site's data erases it.
- Only NTSC 1.02 is supported.

## Building

From the repository root, with Emscripten and the LLVM tools set up as in
`port/tools/build_web.py`:

```
python port/tools/build_web.py
```

The output goes to this folder.
