"""Zal o'lchamlari va joylashuvi (metr, Blender koordinatalari: X - eni, Y - ekran tomonga, Z - yuqoriga).

Ekran +Y tomonda (old devor), orqa devor -Y tomonda.
"""

HALL_X = 9.0            # zal yarim eni (devorlar x = +-9)
FRONT_Y = 13.0          # old devor (ekran)
BACK_Y = -10.5          # orqa devor
CEIL_Z = 9.6            # ship balandligi

STAGE_Y = 11.4          # sahna old cheti
STAGE_Z = 0.45

SCREEN_W = 12.8         # 16:9
SCREEN_H = 7.2
SCREEN_Z0 = 1.4         # ekran pastki cheti
SCREEN_Y = 12.86

ROWS = 10
ROW_DEPTH = 1.35
ROW_RISE = 0.4
FIRST_ROW_Y = 5.5       # A qatorning old cheti
AISLE_X = 7.7           # o'tish yo'laklari |x| > AISLE_X

SEATS_PER_ROW = 21
SEAT_PITCH = 0.7
SEAT_OFFSET = 0.46      # o'rindiq markazi qator orqa chetidan

WALKWAY_Z = ROWS * ROW_RISE          # orqa yo'lak balandligi
WALKWAY_FRONT_Y = FIRST_ROW_Y - ROWS * ROW_DEPTH

DOOR_Y0, DOOR_Y1 = 8.3, 10.1         # yon eshiklar (chap - kirish, o'ng - chiqish)
DOOR_H = 2.4
SWITCH_Y, SWITCH_Z = 10.55, 1.25     # chap devordagi chiroq tugmasi

ROW_LETTERS = 'ABCDEFGHIJKLMN'


def row_front(i):
    return FIRST_ROW_Y - i * ROW_DEPTH


def row_back(i):
    return row_front(i) - ROW_DEPTH


def row_z(i):
    return i * ROW_RISE


def seat_x(k):
    return (k - (SEATS_PER_ROW - 1) / 2) * SEAT_PITCH


def armrest_x(k):
    return (k - SEATS_PER_ROW / 2) * SEAT_PITCH


def seat_y(i):
    return row_back(i) + SEAT_OFFSET
