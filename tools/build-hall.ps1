# Zalni Blender'da quradi va lightmap'larni pishiradi.
#   powershell -File tools/build-hall.ps1            # qurish + to'liq pishirish
#   powershell -File tools/build-hall.ps1 -Fast      # tezkor (past sifat) pishirish
param([switch]$Fast, [switch]$NoBake)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$blender = if ($env:BLENDER) { $env:BLENDER } else { 'D:\dev-tools\blender\blender.exe' }

& $blender -b --factory-startup -P "$root\assets-src\blender\hall_build.py"
if ($LASTEXITCODE -ne 0) { throw 'hall_build.py xato bilan tugadi' }
if ($NoBake) { return }

$bakeArgs = if ($Fast) { @('--res', '1024', '--samples', '32', '--ao-res', '512') }
            else { @('--res', '2048', '--samples', '256', '--ao-res', '1024') }
& $blender -b "$root\assets-src\out\hall.blend" -P "$root\assets-src\blender\hall_bake.py" -- @bakeArgs
if ($LASTEXITCODE -ne 0) { throw 'hall_bake.py xato bilan tugadi' }

# Shovqinni alohida (yengil) jarayonda tozalash
$lm = "$root\client\public\lightmaps"
& $blender -b --factory-startup -P "$root\assets-src\blender\denoise.py" -- "$lm\house.exr" "$lm\base.exr" "$lm\screen.exr"
if ($LASTEXITCODE -ne 0) { throw 'denoise.py xato bilan tugadi' }
