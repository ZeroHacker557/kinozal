"""Kinoteatr o'rindig'i: baxmal yumshoq qismlar, plastik qobiq, tirsaklik va stakan ushlagich.
Mahalliy koordinatalar: markaz poldagi o'rindiq o'qida, old tomon +Y (ekranga)."""
import math
from mathutils import Matrix
from common import MeshBuilder, make_material


def seat_materials():
    return dict(
        velvet=make_material('SeatVelvet', (0.32, 0.025, 0.04), rough=0.9),
        plastic=make_material('SeatPlastic', (0.025, 0.025, 0.028), rough=0.45),
        pad=make_material('ArmPad', (0.03, 0.028, 0.027), rough=0.55),
        metal=make_material('MetalBrushed', (0.55, 0.55, 0.56), rough=0.35, metal=1.0),
        hole=make_material('CupHole', (0.005, 0.005, 0.005), rough=0.9),
    )


def build_seat(coll=None):
    M = seat_materials()
    b = MeshBuilder('Seat')

    # O'tirgich (oldi biroz ko'tarilgan)
    cush = Matrix.Translation((0, 0.15, 0.47)) @ Matrix.Rotation(math.radians(4), 4, 'X')
    b.box((-0.265, -0.26, -0.06), (0.265, 0.26, 0.065), M['velvet'], bevel=0.045, segments=4, matrix=cush)
    # O'tirgich tagidagi plastik qobiq
    base = Matrix.Translation((0, 0.15, 0.40)) @ Matrix.Rotation(math.radians(4), 4, 'X')
    b.box((-0.275, -0.25, -0.05), (0.275, 0.25, 0.01), M['plastic'], bevel=0.02, segments=2, matrix=base)

    # Suyanchiq (orqaga 10 daraja qiya)
    back = Matrix.Translation((0, -0.17, 0.50)) @ Matrix.Rotation(math.radians(10), 4, 'X')
    b.box((-0.265, -0.06, 0.0), (0.265, 0.06, 0.64), M['velvet'], bevel=0.05, segments=4, matrix=back)
    # Bel yostiqchasi va bosh yostiqchasi - shaklni boyitadi
    b.box((-0.24, 0.0, 0.08), (0.24, 0.085, 0.30), M['velvet'], bevel=0.04, segments=4, matrix=back)
    b.box((-0.25, 0.0, 0.50), (0.25, 0.07, 0.63), M['velvet'], bevel=0.035, segments=4, matrix=back)
    # Orqa qobiq
    b.box((-0.28, -0.12, -0.04), (0.28, -0.04, 0.67), M['plastic'], bevel=0.03, segments=3, matrix=back)
    # O'rindiq raqami uchun metall plastinka (orqa tomonda)
    b.box((-0.05, -0.128, 0.56), (0.05, -0.118, 0.61), M['metal'], bevel=0.003, segments=1, matrix=back)

    seat = b.build(coll, smooth_angle=40)

    a = MeshBuilder('Armrest')
    # Yon tayanch (oyoq vazifasini ham bajaradi)
    a.box((-0.028, -0.30, 0.0), (0.028, 0.34, 0.60), M['plastic'], bevel=0.012, segments=2)
    # Tirsak yostiqchasi
    a.box((-0.05, -0.26, 0.60), (0.05, 0.40, 0.655), M['pad'], bevel=0.022, segments=3)
    # Stakan ushlagich
    a.cylinder((0, 0.45, 0.625), 0.052, 0.07, M['plastic'], segments=28)
    a.cylinder((0, 0.45, 0.6615), 0.043, 0.003, M['hole'], segments=28)
    # Polga mahkamlash plastinkasi
    a.box((-0.05, -0.22, 0.0), (0.05, 0.28, 0.012), M['metal'], bevel=0.004, segments=1)
    arm = a.build(coll, smooth_angle=40)
    return seat, arm
