# source this: sets up emscripten in git-bash
export EMSDK=/c/Users/Tactics/aviaozin3-port/emsdk
export EMSDK_PYTHON="$(cygpath -u "$(py -c 'import sys;print(sys.executable)')")"
export PATH="$EMSDK/upstream/emscripten:$EMSDK/upstream/bin:$(ls -d $EMSDK/node/* | head -1):$PATH"
