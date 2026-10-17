"""Generate a 3x3 lever-operated piston door as a Litematica schematic.

The gap (x=0..2, y=1..3) lies in a wall at z=0. Every one of the 9 gap cells is
filled by the head of its own sticky piston when extended:

  left column   x=-1 facing east   (3 pistons)
  right column  x=3  facing west   (3 pistons)
  top middle    (1,4,0) facing down
  bottom middle (1,0,0) facing up
  centre        (1,2,-1) facing south, behind the wall (the only cell that
                cannot be reached from inside the wall plane)

Each group is powered by a solid block with a lever on it. For the two stacked
columns, that block sits between two lone dust that it powers from above/below
(a lone dust powers every horizontal neighbour), so one lever drives three
pistons.

Levers ON -> pistons extend, door closed. Levers OFF -> door open.
Open lanes are x=0 and x=2 (the centre piston behind the wall blocks x=1).
"""
import os
from litemapy import Region, BlockState

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "piston_door_3x3.litematic")

X0, X1 = -5, 7    # world x range
Y0, Y1 = 0, 4
Z0, Z1 = -3, 2
reg = Region(0, 0, 0, X1 - X0 + 1, Y1 - Y0 + 1, Z1 - Z0 + 1)


def put(x, y, z, block):
    reg[x - X0, y - Y0, z - Z0] = block


brick = BlockState("minecraft:stone_bricks")
floor = BlockState("minecraft:polished_andesite")
dust = BlockState("minecraft:redstone_wire", north="none", east="none", south="none", west="none", power="0")


def piston(facing):
    return BlockState("minecraft:sticky_piston", facing=facing, extended="false")


def lever(facing):
    return BlockState("minecraft:lever", face="wall", facing=facing, powered="false")


# floor
for x in range(X0, X1 + 1):
    for z in range(Z0, Z1 + 1):
        put(x, 0, z, floor)

# wall (z=0): sides and lintel
for x in range(X0, X1 + 1):
    for y in (1, 2, 3):
        if not 0 <= x <= 2:
            put(x, y, 0, brick)
    put(x, 4, 0, brick)

# left column: pistons, powered block with lever, lone dust above and below it
for y in (1, 2, 3):
    put(-1, y, 0, piston("east"))
put(-2, 1, 0, dust)
put(-2, 2, 0, brick)
put(-2, 3, 0, dust)
put(-2, 2, 1, lever("south"))

# right column
for y in (1, 2, 3):
    put(3, y, 0, piston("west"))
put(4, 1, 0, dust)
put(4, 2, 0, brick)
put(4, 3, 0, dust)
put(4, 2, 1, lever("south"))

# top middle: piston in the lintel, powered block beside it
put(1, 4, 0, piston("down"))
put(2, 4, 1, lever("south"))          # attached to the lintel block (2,4,0)

# bottom middle: piston in the floor, lever on the floor block beside it
put(1, 0, 0, piston("up"))
put(2, 0, 1, lever("south"))          # attached to the floor block (2,0,0); replaces floor at (2,0,1)

# centre: piston behind the wall pushing south into the gap
put(1, 2, -1, piston("south"))
put(1, 2, -2, brick)
put(1, 2, -3, lever("north"))

schem = reg.as_schematic(name="Piston Door 3x3", author="Claude",
                         description="3x3 lever-operated piston door")
schem.save(OUT)
print("saved", OUT)
