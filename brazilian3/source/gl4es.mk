# Builds gl4es as a static library for Emscripten/WebGL
GL4ES := ../gl4es
SRCS  := $(filter-out $(GL4ES)/src/gl/wrap/gl4eswraps.c,) $(shell sed -n '/^SET(GL_SRC/,/^)/p' $(GL4ES)/src/CMakeLists.txt | grep -o 'gl/[A-Za-z0-9_/]*\.c' | sed 's#^#$(GL4ES)/src/#') $(GL4ES)/src/glx/hardext.c
OBJS  := $(patsubst $(GL4ES)/src/%.c,gl4es/%.o,$(SRCS))
CFLAGS := -O2 -std=gnu99 -DNOX11 -DNOEGL -DSTATICLIB -DNO_GBM -DDEFAULT_ES=2 -DNO_INIT_CONSTRUCTOR \
          -I$(GL4ES)/include -I$(GL4ES)/src/util -I$(GL4ES)/src/glx -Wno-everything
all: libgl4es.a
libgl4es.a: $(OBJS)
	emar rcs $@ $^
gl4es/%.o: $(GL4ES)/src/%.c
	@mkdir -p $(dir $@)
	emcc $(CFLAGS) -c $< -o $@
