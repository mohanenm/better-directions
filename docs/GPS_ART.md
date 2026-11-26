# GPS art

GPS art finds a walk whose trace draws a shape: a heart, star, circle, square or triangle, or a letter you can draw without lifting the pen (L, M, N, U, V, W, Z). It starts from your *From* point and loops back, or ends where the letter ends. It's experimental, and it looks it in places.

![Twelve GPS art results on Lyon: walked trace in magenta, ideal shape dashed](images/gps-art-sheet.png)

## How it works

The code is in `app/src/art/`.

1. Each template is a polyline in a unit box (`shapes.ts`).
2. You pick a walk of about 25, 40, 55 or 75 minutes, and the shape is scaled so its outline, plus a typical 25% for street detours, takes that long at 1.3 m/s. Sizing by time rather than distance matters: sized in metres, most shapes overshot the one-hour limit.
3. The shape's first point is anchored at your start. The search tries 75 placements (5 rotations, 3 sizes, 5 small offsets) and scores each by how close its outline runs to the street network, using a precomputed cloud of points every 20 m along every walkable edge.
4. For the four best placements, it routes corner to corner with a corridor cost (walking time, multiplied the further a street strays from the ideal line), trims dead-end spurs, and keeps the best trace within the cap: an hour, or an hour and a half for the 75-minute option.
5. Likeness compares the walk with the shape: the mean distance between them in both directions, sampled every 20 m, relative to the shape's width. 80% or more reads clearly, around 70% is recognisable, and under 60% needs squinting.

Every leg is an ordinary router search, so the safety rules apply as they do to any route. Each drawing is checked by `assertRouteSafe` with its cap, and the safety property test draws random shapes from random starts.

## Results on Lyon

Nine shapes in five neighbourhoods (Presqu'île, Part-Dieu, Croix-Rousse, Guillotière, Villeurbanne) at three lengths: 130 of 135 attempts produced a drawing.

| Shape | Drawn | Median likeness | Best |
|---|---:|---:|---:|
| Letter L | 15/15 | 85% | 91% |
| Letter V | 15/15 | 80% | 88% |
| Square | 14/15 | 78% | 87% |
| Triangle | 15/15 | 78% | 85% |
| Letter Z | 15/15 | 75% | 85% |
| Letter N | 15/15 | 73% | 86% |
| Heart | 13/15 | 70% | 85% |
| Circle | 14/15 | 70% | 83% |
| Star | 14/15 | 64% | 81% |

Planning takes about 115 ms (median) on a laptop. To reproduce: `npx vitest run --config vitest.bench.config.ts app/bench/art.bench.ts`.

## Limitations

Straight-edged shapes suit a city of streets, and Guillotière's regular grid is the best canvas in Lyon. Stars come out worst, because their sharp points fight the grid. Circles and hearts pick up notches in irregular districts. Shapes that overlap the Rhône or Saône distort or fail, since the placement search only nudges by about 100 m. Likeness is purely geometric: it doesn't know that a heart's cusp matters more than a wobble on its side.

## Spelling a word

The Spell a word section draws 2 to 6 capital letters and digits with a stroke font (`app/src/art/font.ts`) made mostly of straight lines and right angles. The word is laid out left to right and sized so the whole walk should take under an hour: letters are between 160 and 450 m tall. If even the smallest size won't fit, the page says so, and for a name of several words suggests its initials. In practice 4 or 5 letters is the most that fits; 6 only with narrow characters.

Placements are tried at a few rotations (level, ±8°, and the dominant street direction within 700 m), two sizes and five offsets, scored against the street network, and the five best are traced. Each stroke is traced like a shape; between strokes the walk takes the shortest way to the next one, shown dotted on the map. Readability is the same chamfer measure as likeness, per letter and overall, relative to the letter height.

Grids spell far better than old towns. In Guillotière, two-letter words read at about 75%; four-letter words in Lyon come out around 220 m tall to fit the hour and read at about 50%. Below 60% the page says the area spells poorly.

The word never leaves the device unless you tick "Include the word in shared links". Without it, Share link is off, and the share image is titled "A word, walked".
