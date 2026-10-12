The game's own files go here:

  Henry.swf        the hub: menus + Breaking the Bank, Escaping the Prison,
                   Stealing the Diamond, Infiltrating the Airship
  HenryFtC.swf     Fleeing the Complex
  HenryCtM.swf     Completing the Mission (part 1)
  HenryCtM2.swf    Completing the Mission (part 2)
  *_english.txt    subtitle files (the game reads ftc_/ctm_<language>.txt)

They come from the Steam release's install folder.

Files over 100 MB are stored split into parts (e.g. Henry.swf.part1 and
Henry.swf.part2), listed in split-files.json. The page joins them back
together while loading. Use split-files.py in the folder above to split or
rejoin them (see README.md, "Large files").

games.json tells the page which file to start and which files that one loads
by itself (used for the loading progress bar). Only Henry.swf is meant to be
started directly; the others are loaded by it.
