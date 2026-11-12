# Equivalente do build.sh para Windows: copia o núcleo Python para dentro do site.
$ErrorActionPreference = "Stop"
$site = $PSScriptRoot
$destino = Join-Path $site "nucleo"
if (Test-Path $destino) { Remove-Item -Recurse -Force $destino }
New-Item -ItemType Directory -Path $destino | Out-Null
Copy-Item (Join-Path $site "..\nucleo\*.py") $destino
$nomes = (Get-ChildItem (Join-Path $destino "*.py")).Name
[System.IO.File]::WriteAllText((Join-Path $destino "lista.txt"), (($nomes -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Núcleo copiado para site\nucleo ($($nomes.Count) arquivos)."
