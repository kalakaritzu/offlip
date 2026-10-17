"""Generate a lever-operated piston door as a Litematica schematic.

Layout (front view, looking north, x grows to the right, wall plane is z=1):

  y=3   . D D L L L L L        D = redstone dust on top of the wall
  y=2   B B T S P . B B B      T = solid block holding the lever (front face)
  y=1   B B d d P . B B B      S = solid block powered by the dust above it
  y=0   F F F F F F F F F      d = dust feeding the lower piston
                               P = sticky piston facing east, '.' = door gap

Lever ON  -> both pistons extend, heads fill the 1x2 gap (door closed).
Lever OFF -> pistons retract (door open).
"""
import os
from litemapy import Schematic, Region, BlockState

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "piston_door.litematic")

W, H, L = 9, 4, 3  # x, y, z size
OX = 4  # x offset so the door gap sits at x=4 (local x = world x + OX)

reg = Region(0, 0, 0, W, H, L)


def put(x, y, z, block):
    reg[x + OX, y, z + 1] = block


brick = BlockState("minecraft:stone_bricks")
floor = BlockState("minecraft:polished_andesite")
piston = BlockState("minecraft:sticky_piston", facing="east", extended="false")


def wire(**conn):
    props = {"north": "none", "east": "none", "south": "none", "west": "none", "power": "0"}
    props.update(conn)
    return BlockState("minecraft:redstone_wire", **props)


# floor, 3 deep so the lever has somewhere to stand
for x in range(-4, 5):
    for z in (-1, 0, 1):
        put(x, 0, z, floor)

# right wall and lintel above the gap (gap is x=0)
for x in range(1, 5):
    for y in (1, 2):
        put(x, y, 0, brick)
for x in range(-1, 5):
    put(x, 3, 0, brick)

# left wall
for x in (-4, -3, -2):
    for y in (1, 2):
        put(x, y, 0, brick)
put(-4, 3, 0, brick)

# mechanism (overwrites the left wall blocks where needed)
put(-1, 1, 0, piston)
put(-1, 2, 0, piston)
put(-2, 1, 0, wire(west="side"))          # feeds lower piston from behind
put(-3, 1, 0, wire(east="side"))
put(-2, 2, 0, brick)                      # block powered by dust on top
put(-3, 2, 0, brick)                      # lever block, powers dust above and below
put(-2, 3, 0, wire(west="side"))
put(-3, 3, 0, wire(east="side"))
put(-3, 2, 1, BlockState("minecraft:lever", face="wall", facing="south", powered="false"))

schem = reg.as_schematic(name="Piston Door", author="Claude",
                         description="1x2 lever-operated piston door")
schem.save(OUT)
print("saved", OUT)
