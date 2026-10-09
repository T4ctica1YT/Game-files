#!/bin/sh
# build.sh -- rebuild the AVIAOZINHO 3 browser port and refresh the Web-Build folder.
#
# Layout (this folder):
#   emsdk/         Emscripten SDK (emsdk install/activate latest)
#   gl4es/         ptitSeb/gl4es: OpenGL 1.x/2.x -> WebGL 2 translation (patched: src/glx/hardext.c, src/gl/enable.c, src/gl/hint.c)
#   qssm/          timbergeron/QSS-M at the last 1.6.2 commit (2ddbf42a), branch "web" with the port changes
#                  browser-specific code lives in qssm/Quake/web/
#   build/         object files, libgl4es.a, build/engine/qssm.{js,wasm}
#   tools/         deploy.mjs (copies engine + game data into Web-Build), serve.mjs, smoke tests
#
# Usage (Git Bash):  ./build.sh            incremental build + deploy
#                    ./build.sh clean      full rebuild
set -e
cd "$(dirname "$0")"
. ./env.sh

if [ "$1" = "clean" ]; then
	rm -rf build/gl4es build/libgl4es.a
	make -C qssm/Quake/web clean
fi

make -C build -f gl4es.mk -j8
make -C qssm/Quake/web -j8
node tools/deploy.mjs
